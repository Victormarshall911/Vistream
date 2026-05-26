import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
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
      </Stack>
    </SafeAreaProvider>
  );
}
