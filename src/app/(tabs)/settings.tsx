import { View, Text } from "react-native";

export default function SettingsScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-black">
      <Text className="text-2xl font-bold text-white mb-2">Settings</Text>
      <Text className="text-zinc-400 text-base">TMDB API Key input</Text>
    </View>
  );
}
