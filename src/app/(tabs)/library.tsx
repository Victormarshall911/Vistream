import { View, Text } from "react-native";

export default function LibraryScreen() {
  return (
    <View className="flex-1 items-center justify-center bg-black">
      <Text className="text-2xl font-bold text-white mb-2">Library</Text>
      <Text className="text-zinc-400 text-base">Watch History & Saved Items</Text>
    </View>
  );
}
