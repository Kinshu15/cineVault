import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: {
            backgroundColor: '#0B0C0E',
          },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: {
            fontWeight: 'bold',
          },
          contentStyle: {
            backgroundColor: '#0B0C0E',
          },
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: 'cineVault',
            headerShown: false,
          }}
        />
      </Stack>
    </>
  );
}
