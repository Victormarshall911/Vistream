import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="watch/[id]"
          options={{
            headerStyle: { backgroundColor: '#09090b' },
            headerTintColor: '#ffffff',
            presentation: 'card',
          }}
        />
        <Stack.Screen name="+not-found" />
      </Stack>
    </>
  );
}
