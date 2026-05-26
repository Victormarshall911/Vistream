import { useEffect, useState } from "react";
import { View, Text, FlatList, Pressable, Platform } from "react-native";
import { DownloadTask, subscribeToDownloads, deleteDownload, pauseDownload, resumeDownload } from "@/services/downloads";
import { Play, Pause, Trash2, Video } from "lucide-react-native";
import { useRouter } from "expo-router";

export default function DownloadsScreen() {
  const [downloads, setDownloads] = useState<DownloadTask[]>([]);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = subscribeToDownloads((list) => {
      setDownloads(list);
    });
    return unsubscribe;
  }, []);

  function handlePlay(task: DownloadTask) {
    if (task.localUri) {
      router.push({
        pathname: "/watch/[id]",
        params: { id: task.id, type: task.type, title: task.title, localUri: task.localUri },
      });
    }
  }

  function renderItem({ item }: { item: DownloadTask }) {
    const isCompleted = item.status === "completed";
    const progressPercent = Math.round(item.progress * 100);

    return (
      <View className="flex-row items-center p-4 bg-zinc-900 mb-3 rounded-xl border border-zinc-800">
        <View className="w-16 h-24 bg-zinc-800 rounded-lg items-center justify-center mr-4">
           <Video color="#52525b" size={24} />
        </View>
        <View className="flex-1 justify-center">
          <Text className="text-white font-semibold text-base mb-1" numberOfLines={1}>{item.title}</Text>
          {isCompleted ? (
            <Text className="text-emerald-400 text-xs">Downloaded</Text>
          ) : (
            <View>
              <Text className="text-zinc-400 text-xs mb-1">
                {item.status === 'downloading' ? `Downloading... ${progressPercent}%` : `Paused... ${progressPercent}%`}
              </Text>
              <View className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                <View className="h-full bg-red-500" style={{ width: `${progressPercent}%` }} />
              </View>
            </View>
          )}
        </View>
        <View className="flex-row items-center gap-x-3 ml-2">
          {item.status === 'downloading' && (
            <Pressable onPress={() => pauseDownload(item.id)} className="p-2">
              <Pause color="#a1a1aa" size={20} />
            </Pressable>
          )}
          {item.status === 'paused' && (
            <Pressable onPress={() => resumeDownload(item.id)} className="p-2">
              <Play color="#a1a1aa" size={20} />
            </Pressable>
          )}
          {isCompleted && (
             <Pressable onPress={() => handlePlay(item)} className="p-2">
              <Play color="#ef4444" size={20} />
            </Pressable>
          )}
          <Pressable onPress={() => deleteDownload(item.id)} className="p-2">
            <Trash2 color="#ef4444" size={20} />
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black p-4">
      <Text className="text-2xl font-bold text-white mb-6 mt-4">Downloads</Text>
      {downloads.length === 0 ? (
        <View className="flex-1 items-center justify-center">
           <Video color="#3f3f46" size={48} />
           <Text className="text-zinc-500 mt-4 text-center">No downloads yet.</Text>
           <Text className="text-zinc-600 text-sm mt-2 text-center">Download MP4 streams to watch offline.</Text>
        </View>
      ) : (
        <FlatList
          data={downloads}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerClassName="pb-20"
        />
      )}
    </View>
  );
}
