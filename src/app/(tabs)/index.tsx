import { View, Text, ScrollView, Pressable, TextInput, StyleSheet, Platform, Image } from "react-native";
import { useState } from "react";
import { Search, Film, Tv } from "lucide-react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

const TMDB_IMG = 'https://image.tmdb.org/t/p/w300';

const FEATURED = [
  { id: "157336", title: "Interstellar",     type: "movie"  as const, year: "2014", genre: "Sci-Fi",  poster: "/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg" },
  { id: "1396",   title: "Breaking Bad",     type: "series" as const, year: "2008", genre: "Drama",   poster: "/ggFHVNu6YYI5L9pCfOacjizRGt.jpg" },
  { id: "603",    title: "The Matrix",       type: "movie"  as const, year: "1999", genre: "Action",  poster: "/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg" },
  { id: "1399",   title: "Game of Thrones",  type: "series" as const, year: "2011", genre: "Fantasy", poster: "/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg" },
  { id: "19404",  title: "Inception",        type: "movie"  as const, year: "2010", genre: "Thriller",poster: "/ljsZTbVsrQSqZgWeep2B1QiDKuh.jpg" },
];

const TRENDING = [
  { id: "569094",  title: "Spider-Man: Across the Spider-Verse", type: "movie"  as const, poster: "/8Vt6mWEReuy4Of61Lnj5Xj704m8.jpg" },
  { id: "872585",  title: "Oppenheimer",                         type: "movie"  as const, poster: "/ptpr0kGAckfQkJeJIt8st5dglvd.jpg" },
  { id: "100088",  title: "The Last of Us",                      type: "series" as const, poster: "/uKvVjHNqB5VmOrdxqAt2F7J78ED.jpg" },
  { id: "76479",   title: "The Boys",                            type: "series" as const, poster: "/stTEycfG9928HYGEiL6SWR7ARYA.jpg" },
  { id: "94997",   title: "House of the Dragon",                 type: "series" as const, poster: "/z2yahl2uefxDCl0nogcRBstwruJ.jpg" },
];

export default function HomeScreen() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");

  function handlePlay(id: string, type: "movie" | "series", title: string) {
    router.push({ pathname: "/watch/[id]", params: { id, type, title } });
  }

  const filteredFeatured = FEATURED.filter((i) =>
    i.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const filteredTrending = TRENDING.filter((i) =>
    i.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.logo}>
            Vi<Text style={styles.logoAccent}>stream</Text>
          </Text>
          <Text style={styles.tagline}>Stream anything, anywhere.</Text>
        </View>

        {/* Search */}
        <View style={styles.searchRow}>
          <Search color="#52525b" size={18} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search movies, series..."
            placeholderTextColor="#52525b"
            style={styles.searchInput}
            returnKeyType="search"
          />
        </View>

        {/* Featured */}
        <Text style={styles.sectionTitle}>⭐  Featured</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalList}
        >
          {filteredFeatured.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => handlePlay(item.id, item.type, item.title)}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            >
              <View style={styles.cardPoster}>
                <Image
                  source={{ uri: `${TMDB_IMG}${item.poster}` }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                />
                {/* Gradient-like darkening overlay at bottom */}
                <View style={styles.cardPosterOverlay} />
              </View>
              <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.cardMeta}>{item.year} · {item.genre}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Trending */}
        <Text style={[styles.sectionTitle, styles.sectionTitleSpaced]}>🔥  Trending Now</Text>
        <View style={styles.trendingList}>
          {filteredTrending.map((item, index) => (
            <Pressable
              key={item.id}
              onPress={() => handlePlay(item.id, item.type, item.title)}
              style={({ pressed }) => [styles.trendingRow, pressed && styles.cardPressed]}
            >
              <Text style={styles.trendingIndex}>
                {String(index + 1).padStart(2, "0")}
              </Text>
              <View style={styles.trendingIcon}>
                <Image
                  source={{ uri: `${TMDB_IMG}${item.poster}` }}
                  style={{ width: 40, height: 40, borderRadius: 10 }}
                  resizeMode="cover"
                />
              </View>
              <View style={styles.trendingInfo}>
                <Text style={styles.trendingTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.trendingType}>{item.type}</Text>
              </View>
              <View style={styles.watchBadge}>
                <Text style={styles.watchBadgeText}>Watch</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#000",
  },
  scroll: {
    flex: 1,
    backgroundColor: "#000",
  },
  scrollContent: {
    paddingBottom: 100,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 24,
  },
  logo: {
    fontSize: 36,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -1,
  },
  logoAccent: {
    color: "#ef4444",
  },
  tagline: {
    fontSize: 14,
    color: "#71717a",
    marginTop: 4,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 20,
    marginBottom: 32,
    backgroundColor: "#18181b",
    borderWidth: 1,
    borderColor: "#27272a",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    color: "#fff",
    fontSize: 14,
    // @ts-ignore — web needs outlineWidth: 0
    outlineWidth: 0,
  },
  sectionTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  sectionTitleSpaced: {
    marginTop: 32,
  },
  horizontalList: {
    paddingHorizontal: 20,
    gap: 16,
    paddingBottom: 4,
  },
  card: {
    width: 152,
  },
  cardPressed: {
    opacity: 0.65,
  },
  cardPoster: {
    width: 152,
    height: 216,
    backgroundColor: "#18181b",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#27272a",
    overflow: "hidden",
    marginBottom: 10,
  },
  cardPosterOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  cardTitle: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 13,
    marginBottom: 2,
  },
  cardMeta: {
    color: "#52525b",
    fontSize: 12,
  },
  trendingList: {
    paddingHorizontal: 20,
    gap: 10,
  },
  trendingRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#18181b",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#27272a",
    padding: 14,
    gap: 14,
  },
  trendingIndex: {
    color: "#3f3f46",
    fontSize: 22,
    fontWeight: "900",
    width: 32,
  },
  trendingIcon: {
    width: 40,
    height: 40,
    backgroundColor: "#27272a",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  trendingInfo: {
    flex: 1,
  },
  trendingTitle: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  trendingType: {
    color: "#71717a",
    fontSize: 12,
    textTransform: "capitalize",
    marginTop: 2,
  },
  watchBadge: {
    backgroundColor: "#ef4444",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 100,
  },
  watchBadgeText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 12,
  },
});
