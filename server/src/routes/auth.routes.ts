import { Router, Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt, { SignOptions } from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { authenticateJWT, AuthRequest } from '../middleware/auth.middleware';

const router = Router();
const googleClient = new OAuth2Client();

/**
 * Validates and resolves the JWT expiration duration with proper typing.
 */
function getJwtExpiresIn(): SignOptions['expiresIn'] {
  const configured = process.env.JWT_EXPIRES_IN;
  if (!configured) {
    return '7d';
  }
  const timeSpanRegex = /^(\d+)(s|m|h|d|w|y)?$/i;
  if (timeSpanRegex.test(configured.trim())) {
    return configured.trim() as SignOptions['expiresIn'];
  }
  console.warn(`[Auth] Invalid JWT_EXPIRES_IN "${configured}", falling back to "7d"`);
  return '7d';
}

/**
 * POST /api/auth/google
 * Authenticates user via Google ID Token.
 * Verifies signature, issuer, expiration, audience, and email verification.
 * Creates user or safely resolves existing user without automatic email linking.
 */
router.post('/google', async (req: Request, res: Response): Promise<void> => {
  try {
    const { idToken } = req.body;

    if (!idToken || typeof idToken !== 'string') {
      res.status(400).json({ error: 'Google idToken is required' });
      return;
    }

    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (!googleClientId || googleClientId.trim() === '') {
      console.error('[Auth] GOOGLE_CLIENT_ID is not configured');
      res.status(500).json({ error: 'Server authentication configuration error' });
      return;
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret || jwtSecret.trim() === '') {
      console.error('[Auth] JWT_SECRET is not configured');
      res.status(500).json({ error: 'Server authentication configuration error' });
      return;
    }

    // 1. Verify Google ID token
    let ticket;
    try {
      ticket = await googleClient.verifyIdToken({
        idToken,
        audience: googleClientId,
      });
    } catch (verifyErr: any) {
      console.warn('[Auth] Google token verification failed:', verifyErr.message);
      res.status(401).json({ error: 'Invalid Google identity token' });
      return;
    }

    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      res.status(401).json({ error: 'Invalid token payload' });
      return;
    }

    // 2. Validate issuer
    const validIssuers = ['accounts.google.com', 'https://accounts.google.com'];
    if (!validIssuers.includes(payload.iss)) {
      res.status(401).json({ error: 'Invalid token issuer' });
      return;
    }

    // 3. Robust expiration validation (must be valid number and greater than current time)
    const currentTime = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || isNaN(payload.exp) || payload.exp <= currentTime) {
      res.status(401).json({ error: 'Google ID token has expired or has an invalid expiration' });
      return;
    }

    // 4. Validate verified email
    if (!payload.email_verified) {
      res.status(401).json({ error: 'Google email address is not verified' });
      return;
    }

    const googleId = payload.sub;
    const email = payload.email.toLowerCase();

    // 5. User lookup & conflict prevention
    let user = await prisma.user.findUnique({
      where: { googleId },
    });

    if (user) {
      // Existing user with matching googleId: update profile details if changed
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          displayName: payload.name || user.displayName,
          avatarUrl: payload.picture || user.avatarUrl,
        },
      });
    } else {
      // No user matches this googleId. Check if an account already exists with this email:
      const existingUserByEmail = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUserByEmail) {
        // An account with this email exists but under a different identity / null googleId.
        // Reject automatic linking to avoid account takeover:
        res.status(409).json({
          error: 'An account with this email address already exists. Automatic linking is not permitted.',
        });
        return;
      }

      // Safe to create new user with concurrency / P2002 error handling
      try {
        user = await prisma.user.create({
          data: {
            googleId,
            email,
            displayName: payload.name || null,
            avatarUrl: payload.picture || null,
            watchlists: {
              create: {
                name: 'My Watchlist',
                isDefault: true,
              },
            },
          },
        });
      } catch (createErr: unknown) {
        if (
          createErr instanceof Prisma.PrismaClientKnownRequestError &&
          createErr.code === 'P2002'
        ) {
          const target = (createErr.meta?.target as string[]) || [];
          console.warn(`[Auth] P2002 unique constraint conflict during creation on fields: ${target.join(', ')}`);

          // In case of a race condition where the exact same googleId was just inserted:
          const concurrentUser = await prisma.user.findUnique({
            where: { googleId },
          });

          if (concurrentUser) {
            user = concurrentUser;
          } else {
            res.status(409).json({
              error: 'An account with this email address already exists. Automatic linking is not permitted.',
            });
            return;
          }
        } else {
          throw createErr;
        }
      }
    }

    // 6. Issue cineVault session JWT explicitly with HS256 algorithm
    const expiresIn = getJwtExpiresIn();
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
      },
      jwtSecret,
      {
        algorithm: 'HS256',
        expiresIn,
      }
    );

    res.status(200).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (error: any) {
    console.error('[Auth] Error in /api/auth/google:', error);
    res.status(500).json({ error: 'Internal server authentication error' });
  }
});

/**
 * GET /api/auth/me
 * Returns current authenticated user profile. Protected by JWT.
 */
router.get('/me', authenticateJWT, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.status(200).json({ user });
  } catch (error: any) {
    console.error('[Auth] Error in /api/auth/me:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
