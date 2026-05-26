import { useState } from "react";
import { View, Text, FlatList, Pressable, Image } from "react-native";
import { useAppStore, MediaItem } from "@/store";
import { Clock, Bookmark, Trash2, Play } from "lucide-react-native";
import { useRouter } from "expo-router";

type TabSelection = "history" | "saved";

export default function LibraryScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabSelection>("history");
  
  const history = useAppStore((state) => state.history);
  const savedItems = useAppStore((state) => state.savedItems);
  const clearHistory = useAppStore((state) => state.clearHistory);
  const removeFromSaved = useAppStore((state) => state.removeFromSaved);

  const displayData = activeTab === "history" ? history : savedItems;

  function handlePlay(item: MediaItem) {
    router.push({
      pathname: "/watch/[id]",
      params: { id: item.id, type: item.type, title: item.title },
    });
  }

  function renderItem({ item }: { item: MediaItem }) {
    return (
      <Pressable
        onPress={() => handlePlay(item)}
        className="flex-row items-center p-3 bg-zinc-900 mb-3 rounded-xl border border-zinc-800 active:opacity-70"
      >
        <View className="w-16 h-24 bg-zinc-800 rounded-lg overflow-hidden mr-4 items-center justify-center">
          {item.posterUrl ? (
            <Image source={{ uri: item.posterUrl }} className="w-full h-full" resizeMode="cover" />
          ) : (
             <Play color="#52525b" size={24} />
          )}
        </View>
        <View className="flex-1 justify-center">
          <Text className="text-white font-semibold text-base mb-1" numberOfLines={2}>
            {item.title}
          </Text>
          <Text className="text-zinc-500 text-xs uppercase tracking-wider mb-2">
            {item.type}
          </Text>
          <Text className="text-zinc-600 text-xs">
            {new Date(item.timestamp).toLocaleDateString()}
          </Text>
        </View>
        <View className="ml-2">
          {activeTab === "saved" && (
            <Pressable onPress={() => removeFromSaved(item.id)} className="p-2">
              <Trash2 color="#ef4444" size={20} />
            </Pressable>
          )}
        </View>
      </Pressable>
    );
  }

  return (
    <View className="flex-1 bg-black p-4">
      <Text className="text-2xl font-bold text-white mb-6 mt-4">Library</Text>
      
      {/* Tabs */}
      <View className="flex-row mb-6 gap-x-4">
        <Pressable
          onPress={() => setActiveTab("history")}
          className={`flex-row items-center gap-x-2 pb-2 border-b-2 ${
            activeTab === "history" ? "border-red-500" : "border-transparent"
          }`}
        >
          <Clock color={activeTab === "history" ? "#ef4444" : "#71717a"} size={18} />
          <Text
            className={`font-semibold ${
              activeTab === "history" ? "text-white" : "text-zinc-500"
            }`}
          >
            History
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setActiveTab("saved")}
          className={`flex-row items-center gap-x-2 pb-2 border-b-2 ${
            activeTab === "saved" ? "border-red-500" : "border-transparent"
          }`}
        >
          <Bookmark color={activeTab === "saved" ? "#ef4444" : "#71717a"} size={18} />
          <Text
            className={`font-semibold ${
              activeTab === "saved" ? "text-white" : "text-zinc-500"
            }`}
          >
            Saved Items
          </Text>
        </Pressable>
      </View>

      {/* Header Actions */}
      {activeTab === "history" && history.length > 0 && (
        <View className="flex-row justify-end mb-4">
          <Pressable onPress={clearHistory} className="active:opacity-60">
            <Text className="text-zinc-500 text-sm">Clear History</Text>
          </Pressable>
        </View>
      )}

      {/* List */}
      {displayData.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          {activeTab === "history" ? (
            <Clock color="#3f3f46" size={48} />
          ) : (
            <Bookmark color="#3f3f46" size={48} />
          )}
          <Text className="text-zinc-500 mt-4 text-center">
            {activeTab === "history"
              ? "No watch history yet."
              : "You haven't saved any items."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={displayData}
          keyExtractor={(item) => `${item.id}-${item.timestamp}`}
          renderItem={renderItem}
          contentContainerClassName="pb-20"
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}
