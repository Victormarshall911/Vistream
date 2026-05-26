import { Tabs } from "expo-router";
import { Home, Library, Download, Settings } from "lucide-react-native";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#ef4444", // High contrast red accent
        tabBarInactiveTintColor: "#71717a", // zinc-500
        tabBarStyle: {
          backgroundColor: "#09090b", // zinc-950
          borderTopColor: "#27272a", // zinc-800
          paddingBottom: 4,
        },
        headerStyle: {
          backgroundColor: "#09090b",
        },
        headerTintColor: "#fff",
        sceneStyle: {
          backgroundColor: "#000",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Home color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: "Library",
          tabBarIcon: ({ color, size }) => <Library color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="downloads"
        options={{
          title: "Downloads",
          tabBarIcon: ({ color, size }) => <Download color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => <Settings color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
