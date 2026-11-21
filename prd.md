# Watchlist — Product Description & Development PRD

## 1. Project Overview

**Project name:** Watchlist

Watchlist is a mobile application for discovering movies and TV shows, maintaining personal watchlists, tracking watched content, rating and reviewing titles, and eventually receiving personalized recommendations and discovering content through social groups.

The application is being developed while I learn React Native through my college classes.

I want to build this project incrementally, understanding the concepts, architecture, and decisions along the way.

**You are my coding assistant and development partner. We will discuss, plan, implement, and test each feature together.**

## 2. Important: This PRD Is a Starting Point

This document describes the current product vision and our initial preferences. It is intended to give you an understanding of the project, its goals, and the direction we are considering.

**It is not a final or unchangeable specification.**

- Requirements may change during development.
- Architecture and technology choices may change if better options become apparent.
- UI designs and user flows may evolve as we learn more.
- You may suggest better approaches, simpler implementations, or useful alternatives.
- Explain the benefits, drawbacks, and implications of significant alternatives before recommending a change.
- Do not silently change agreed decisions or introduce major architectural changes without discussion.
- Do not treat every future feature in this document as something that must be implemented immediately.

The goal is to build a good application while learning, not to follow the original document blindly.

## 3. Critical Instruction: Never Build Everything at Once

**Do not implement the entire application from this PRD in one go.**

This is a long-term project that we will develop one step at a time.

Follow these rules strictly:

1. Start by understanding the project and discussing the first task.
2. Explain the purpose of the task and the relevant concepts.
3. Propose an implementation plan.
4. Wait for my explicit approval before writing code or making project changes.
5. Implement only the currently approved scope.
6. Test the implementation and explain how I can verify it.
7. Summarize what was built and why.
8. Stop and wait for my next instruction.

Do not automatically proceed to the next phase, even if the current phase appears complete.

Do not generate the entire application structure, all screens, backend endpoints, database models, or future features in advance.

Do not install dependencies, modify files, or make project changes before I approve the relevant implementation step.

If an important decision is unclear, ask me rather than making an unnecessary assumption.

## 4. Learning and Communication Style

I am learning React Native while building this application.

Please:

- Explain concepts in beginner-friendly language.
- Keep explanations short and conversational unless I request more detail.
- Explain why a particular approach is appropriate.
- Discuss architecture, pipelines, components, and data flow when relevant.
- Prefer simple solutions over unnecessary abstractions.
- Explain technical trade-offs before significant decisions.
- Help me understand the code rather than simply generating it.
- Avoid overwhelming me with large amounts of code or information.

Do not provide code until I approve the implementation plan for the current task.

## 5. Initial Technology Preferences

These are our current preferences, not permanent commitments.

| Component | Current preference |
|---|---|
| Mobile application | React Native with Expo |
| Backend | Node.js with Express |
| Database | Not decided |
| Authentication | Google Sign-In |
| Movie/show metadata | TMDB API |
| Visual design | Dark, cinematic movie-app theme |

If a better option emerges, explain it and discuss it with me before changing the plan.

### Database

The database has not been selected.

When database selection becomes necessary, compare appropriate options based on project requirements, ease of learning, cost, and integration with the backend.

Do not select or configure a database without discussing the decision with me first.

### Authentication

The current plan is to use Google Sign-In rather than implementing email/password authentication initially.

After authentication, users will complete their Watchlist profile if they are new users.

The exact authentication libraries, token/session strategy, and backend integration approach should be discussed before implementation.

### Movie data

TMDB is the planned source for movie and TV show metadata.

TMDB integration should happen after the initial authentication and users/lists backend work, unless we explicitly agree to change the sequence.

## 6. Product Goals

The complete application should eventually allow users to:

- Sign in with Google.
- Create and manage a Watchlist profile.
- Search for movies and TV shows.
- View movie/show information.
- Maintain a personal watchlist.
- Mark titles as watched.
- Rate and review content.
- Receive personalized recommendations.
- Create and join groups.
- Discover content popular among group members.
- View personal activity and statistics.

These goals describe the intended product, not the initial implementation scope.

## 7. Authentication and Profile Flow

The initial account flow is planned as follows:

### Step 1: Welcome and Sign-In Screen

Display a welcome screen with a prominent **Continue with Google** action.

The screen should fit the dark, cinematic design direction.

### Step 2: Google Authentication

The user selects their Google account and completes the authentication flow.

The backend should verify the Google identity token rather than blindly trusting identity information supplied by the mobile app.

### Step 3: New User Profile Setup

For a new user who has not completed profile setup, show a profile creation screen.

The user should be able to:

- Choose a custom display name.
- Use their Google profile picture initially, if available.
- Review the basic profile information before continuing.

The display name should be independent of the name on their Google account.

We can decide later whether users can upload their own profile pictures or whether additional profile fields are necessary.

### Step 4: Save the Watchlist Profile

The backend should associate the Watchlist profile with the authenticated user's internal account.

The profile should contain the application-specific information required by Watchlist.

The display name and profile information should be stored separately from the user's Google credentials.

### Step 5: Enter the Home Screen

After successful sign-in and profile setup, the user enters the application.

For returning users who have already completed profile setup, the planned behavior is to take them directly to the home screen.

### Important implementation principles

- Do not permanently rely on mock authentication.
- Do not store Google passwords.
- Verify Google identity tokens on the backend.
- Keep the user's Google identity separate from their Watchlist profile.
- Discuss session persistence and secure token storage before implementation.
- Profile editing can be implemented later as a separate feature.

The precise implementation details remain open to discussion.

## 8. Personal Lists and Backend

The backend will eventually manage user-specific information, including:

- User profiles.
- Watchlists.
- Watched content.
- Ratings.
- Reviews.
- Group membership and activity.

Users should only be able to access and modify data they are authorized to access.

For personal lists, the planned approach is to associate each entry with the relevant user and a stable movie/show identifier.

Movie metadata from TMDB should remain logically separate from user-specific information.

The exact database schema and API design should be discussed before implementation.

## 9. Movie and TV Show Discovery

After the initial backend work, the application will integrate with TMDB.

The application may display:

- Title.
- Poster.
- Release date or year.
- Genre.
- Synopsis.
- Rating information.
- Cast.
- Director or creator.
- Content type.

Users should eventually be able to search for titles and open detailed information screens.

We should first verify the basic API data flow before building the complete discovery interface.

## 10. Future Functional Features

These features describe the longer-term product vision.

### Personal Watchlist

- Add and remove movies and shows.
- Mark content as watched.
- View separate or filtered lists.

### Ratings and Reviews

- Rate watched content, potentially on a 1–5 star scale.
- Write reviews.
- View personal ratings and reviews.

### Recommendations

Initially, use a simple approach based on watched content, ratings, and metadata similarity.

The system should avoid recommending titles already watched by the user.

We will discuss the recommendation pipeline and algorithm when we reach that phase.

### Groups and Social Discovery

- Create and join groups.
- View group members.
- View group members' movie/show activity.
- Discover titles trending within a group.

These features are not part of the initial implementation.

### User Profile

The profile may eventually include:

- Display name and profile picture.
- Watched count.
- Watchlist count.
- Review count.
- Group memberships.
- Favorite genres.

## 11. Planned Development Roadmap

This is a proposed roadmap, not permission to implement every phase.

### Phase 1 — Expo Project Setup and Login UI

- Discuss the initial project setup and structure.
- Establish the Expo project after approval.
- Build the login screen.
- Build the signup/profile setup flow as appropriate to the agreed design.
- Add navigation and basic input validation.
- Use a temporary destination screen where needed to test the UI.

The exact screen sequence should be discussed before implementation.

Do not implement real authentication or database integration in this phase unless we explicitly change the scope.

### Phase 2 — Google Authentication

- Choose the appropriate Expo-compatible authentication approach.
- Configure Google Sign-In.
- Implement backend verification of Google identity tokens.
- Create or retrieve Watchlist user accounts.
- Handle new and returning users.
- Establish secure session management.
- Test the authentication flow.

### Phase 3 — Users and Lists Backend

- Finalize the database choice.
- Design the user and personal-list data models.
- Implement the approved Express endpoints.
- Add authorization and input validation.
- Test user-specific list operations.

### Phase 4 — TMDB Integration

- Understand the TMDB API.
- Fetch movie and show metadata.
- Test search and content-detail requests.
- Handle loading states, errors, and empty results.
- Decide whether the mobile app or backend should make TMDB requests after discussing the trade-offs.

### Phase 5 — Main Mobile UI

Build and connect the following screens incrementally:

- Home.
- Search.
- Movie/show details.
- Watchlist.
- Watched content.
- Profile.

### Phase 6 — Ratings and Reviews

Implement rating and review functionality with backend persistence.

### Phase 7 — Recommendations

Design and implement a simple recommendation pipeline.

### Phase 8 — Groups and Social Features

Implement group creation, membership, activity, and trending functionality incrementally.

We may reorder or modify these phases when a better approach is identified and agreed upon.

## 12. Security and Quality Principles

Throughout development:

- Protect authentication and user data.
- Validate backend requests.
- Enforce authorization on protected endpoints.
- Avoid storing sensitive credentials insecurely.
- Handle API failures and invalid input gracefully.
- Keep components reusable where useful.
- Avoid unnecessary complexity.
- Explain security-sensitive decisions before implementing them.

## 13. Current Project Status

- This is a fresh project.
- No existing codebase should be assumed.
- Expo is the current mobile framework preference.
- Node.js and Express are the current backend preferences.
- The database is undecided.
- Google Sign-In is the current authentication preference.
- New users should be able to choose their own display name and initially use their Google profile picture.
- TMDB integration is planned after the initial backend work.
- The intended visual direction is dark and cinematic.

## 14. Instructions for Your First Response

For your first response, do only the following:

1. Confirm your understanding of the Watchlist product and our collaborative development approach.
2. Briefly identify the first task you recommend.
3. Explain why it should come first.
4. Mention any essential decisions we should discuss before starting.
5. Wait for my approval.

**Do not write code, create files, install dependencies, generate the complete project structure, configure authentication, or make any project changes yet.**

We will decide what to implement next together.

Remember: this PRD is a flexible starting point. Suggest better options when appropriate, discuss meaningful trade-offs, and let me approve changes before implementation.