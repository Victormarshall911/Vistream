import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface MediaItem {
  id: string;
  title: string;
  type: 'movie' | 'series' | 'anime';
  posterUrl: string;
  timestamp: number;
}

interface AppState {
  history: MediaItem[];
  savedItems: MediaItem[];
  addToHistory: (item: MediaItem) => void;
  addToSaved: (item: MediaItem) => void;
  removeFromSaved: (id: string) => void;
  clearHistory: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      history: [],
      savedItems: [],
      addToHistory: (item) => set((state) => {
        const filtered = state.history.filter((i) => i.id !== item.id);
        return { history: [item, ...filtered] };
      }),
      addToSaved: (item) => set((state) => {
        if (state.savedItems.some((i) => i.id === item.id)) return state;
        return { savedItems: [item, ...state.savedItems] };
      }),
      removeFromSaved: (id) => set((state) => ({
        savedItems: state.savedItems.filter((i) => i.id !== id),
      })),
      clearHistory: () => set({ history: [] }),
    }),
    {
      name: 'vistream-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
