import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TouchableWithoutFeedback,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Vibration,
  Animated,
  Easing,
  ActivityIndicator,
  Image,
  Modal,
  ScrollView,
  StatusBar as RNStatusBar,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts } from 'expo-font';
import Ionicons from '@expo/vector-icons/Ionicons';

// Firebase Modular SDK
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, Auth } from 'firebase/auth';
import {
  getDatabase,
  ref,
  set,
  push,
  onValue,
  off,
  Database,
  DataSnapshot,
} from 'firebase/database';

// ============================================================================
// 1. FIREBASE CONFIGURATION
// Replace the placeholder values below with your Firebase project credentials.
// Console: https://console.firebase.google.com/ -> Project Settings -> General -> Your apps
//
// Ensure Firebase Realtime Database is enabled in your project.
// Database rules sample:
// {
//   "rules": {
//     "rooms": {
//       "$roomId": {
//         ".read": "auth != null",
//         ".write": "auth != null"
//       }
//     }
//   }
// }
// ============================================================================
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-project-id.firebaseapp.com",
  databaseURL: "https://your-project-id-default-rtdb.firebaseio.com",
  projectId: "your-project-id",
  storageBucket: "your-project-id.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// ============================================================================
// THEME & COLOR PALETTE
// ============================================================================
const THEME = {
  background: '#FAF9F6', // Warm off-white
  partnerBubble: '#EFEBE4', // Soft beige/sand
  partnerText: '#4A2E18', // Deep warm brown
  primaryGold: '#C99E5C', // Warm muted gold / caramel
  userBubble: '#C99E5C', // User bubble background
  userText: '#FFFFFF', // Pure white
  textPrimary: '#4A2E18', // Deep warm brown
  textSecondary: '#7D6E65', // Muted subtitle
  border: '#E8E1D7', // Subtle warm border
  heartRed: '#D9455F', // Romantic heart crimson
  heartGlow: 'rgba(217, 69, 95, 0.25)',
  goldGlow: 'rgba(201, 158, 92, 0.25)',
  cardBg: '#FFFFFF',
  chipBg: '#F3EFE9',
  success: '#5B8E7D',
};

// AsyncStorage Keys
const STORAGE_ROOM_ID = '@farlove_room_id';
const STORAGE_USER_ID = '@farlove_user_id';
const STORAGE_USER_NAME = '@farlove_user_name';
const STORAGE_CUSTOM_FIREBASE = '@farlove_custom_firebase_config';

// Safe haptics / vibration wrapper
const triggerVibration = (pattern: number | number[]) => {
  try {
    if (Platform.OS !== 'web') {
      Vibration.vibrate(pattern);
    } else {
      if (typeof window !== 'undefined' && window.navigator && 'vibrate' in window.navigator) {
        window.navigator.vibrate(pattern);
      }
    }
  } catch (err) {
    // Graceful fallback if unsupported
  }
};

// ============================================================================
// TYPES
// ============================================================================
interface ChatMessage {
  id: string;
  text: string;
  sender: string;
  senderName?: string;
  timestamp: number;
}

interface TouchData {
  timestamp: number;
  sender: string;
  senderName?: string;
}

interface FloatingHeartItem {
  id: string;
  xOffset: number;
  size: number;
  drift: number;
  color: string;
}

// ============================================================================
// FIREBASE CLIENT & FALLBACK DEMO SYNC SYSTEM
// Allows live Firebase WebSockets when configured, and seamless local/demo sync
// when running with placeholder keys or offline.
// ============================================================================
class FirebaseSyncService {
  private app: FirebaseApp | null = null;
  private auth: Auth | null = null;
  private database: Database | null = null;
  private isConfigured: boolean = false;
  private simulatedListeners: Map<string, Array<(data: any) => void>> = new Map();

  constructor() {
    this.initFirebase(firebaseConfig);
  }

  public initFirebase(config: typeof firebaseConfig) {
    const hasRealKeys =
      config.apiKey &&
      config.apiKey !== 'YOUR_API_KEY' &&
      config.databaseURL &&
      config.databaseURL !== 'https://your-project-id-default-rtdb.firebaseio.com';

    this.isConfigured = !!hasRealKeys;

    if (this.isConfigured) {
      try {
        if (!getApps().length) {
          this.app = initializeApp(config);
        } else {
          this.app = getApp();
        }
        this.auth = getAuth(this.app);
        this.database = getDatabase(this.app);
        console.log('[FarLove] Firebase initialized successfully with live Realtime Database WebSockets.');
      } catch (err) {
        console.warn('[FarLove] Firebase live initialization error:', err);
        this.isConfigured = false;
      }
    } else {
      console.log('[FarLove] Running with placeholder config. In-memory demo sync active.');
    }
  }

  public isLiveMode(): boolean {
    return this.isConfigured && this.database !== null;
  }

  // Anonymous Authentication
  public async authenticateAnonymously(fallbackUserId: string): Promise<string> {
    if (this.isConfigured && this.auth) {
      try {
        const userCredential = await signInAnonymously(this.auth);
        return userCredential.user.uid;
      } catch (err) {
        console.warn('[FarLove] Anonymous auth failed, using local user ID:', err);
      }
    }
    return fallbackUserId;
  }

  // Touch listener
  public listenToTouch(roomId: string, callback: (touch: TouchData | null) => void): () => void {
    if (this.isConfigured && this.database) {
      const touchRef = ref(this.database, `rooms/${roomId}/touch`);
      const unsubscribe = onValue(
        touchRef,
        (snapshot: DataSnapshot) => {
          const val = snapshot.val();
          callback(val as TouchData | null);
        },
        (error) => {
          console.warn('[FarLove] Error listening to touch:', error);
        }
      );
      return () => off(touchRef);
    }

    // Demo Mode Simulated Channel
    const channelKey = `touch_${roomId}`;
    if (!this.simulatedListeners.has(channelKey)) {
      this.simulatedListeners.set(channelKey, []);
    }
    this.simulatedListeners.get(channelKey)!.push(callback);

    return () => {
      const list = this.simulatedListeners.get(channelKey) || [];
      this.simulatedListeners.set(
        channelKey,
        list.filter((cb) => cb !== callback)
      );
    };
  }

  // Send Touch
  public async sendTouch(roomId: string, userId: string, userName?: string): Promise<void> {
    const touchData: TouchData = {
      timestamp: Date.now(),
      sender: userId,
      senderName: userName || 'My Love',
    };

    if (this.isConfigured && this.database) {
      const touchRef = ref(this.database, `rooms/${roomId}/touch`);
      await set(touchRef, touchData);
      return;
    }

    // Broadcast to simulated listeners
    const channelKey = `touch_${roomId}`;
    const listeners = this.simulatedListeners.get(channelKey) || [];
    listeners.forEach((cb) => cb(touchData));
  }

  // Messages listener
  public listenToMessages(roomId: string, callback: (messages: ChatMessage[]) => void): () => void {
    if (this.isConfigured && this.database) {
      const messagesRef = ref(this.database, `rooms/${roomId}/messages`);
      const unsubscribe = onValue(
        messagesRef,
        (snapshot: DataSnapshot) => {
          const val = snapshot.val();
          if (!val) {
            callback([]);
            return;
          }
          const list: ChatMessage[] = Object.keys(val).map((key) => ({
            id: key,
            text: val[key].text,
            sender: val[key].sender,
            senderName: val[key].senderName,
            timestamp: val[key].timestamp || Date.now(),
          }));
          list.sort((a, b) => a.timestamp - b.timestamp);
          callback(list);
        },
        (error) => {
          console.warn('[FarLove] Error listening to messages:', error);
        }
      );
      return () => off(messagesRef);
    }

    // Demo Mode Simulated Channel
    const channelKey = `messages_${roomId}`;
    if (!this.simulatedListeners.has(channelKey)) {
      this.simulatedListeners.set(channelKey, []);
    }
    this.simulatedListeners.get(channelKey)!.push(callback);

    // Initial load demo greeting message if empty
    setTimeout(() => {
      const stored = this.getSimulatedMessages(roomId);
      callback(stored);
    }, 50);

    return () => {
      const list = this.simulatedListeners.get(channelKey) || [];
      this.simulatedListeners.set(
        channelKey,
        list.filter((cb) => cb !== callback)
      );
    };
  }

  // Send Message
  public async sendMessage(
    roomId: string,
    text: string,
    userId: string,
    userName?: string
  ): Promise<void> {
    const msgPayload = {
      text: text.trim(),
      sender: userId,
      senderName: userName || 'My Love',
      timestamp: Date.now(),
    };

    if (this.isConfigured && this.database) {
      const messagesRef = ref(this.database, `rooms/${roomId}/messages`);
      await push(messagesRef, msgPayload);
      return;
    }

    // Demo Mode Simulated
    const stored = this.getSimulatedMessages(roomId);
    const newMsg: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      ...msgPayload,
    };
    stored.push(newMsg);
    this.saveSimulatedMessages(roomId, stored);

    const channelKey = `messages_${roomId}`;
    const listeners = this.simulatedListeners.get(channelKey) || [];
    listeners.forEach((cb) => cb([...stored]));
  }

  // Helper for demo messages in memory
  private demoStore: Record<string, ChatMessage[]> = {};
  private getSimulatedMessages(roomId: string): ChatMessage[] {
    if (!this.demoStore[roomId]) {
      this.demoStore[roomId] = [
        {
          id: 'welcome_1',
          text: 'Welcome to our private FarLove sanctuary ❤️',
          sender: 'partner_demo',
          senderName: 'Partner',
          timestamp: Date.now() - 1000 * 60 * 5,
        },
      ];
    }
    return this.demoStore[roomId];
  }

  private saveSimulatedMessages(roomId: string, msgs: ChatMessage[]) {
    this.demoStore[roomId] = msgs;
  }

  // Trigger simulated partner touch for testing reaction
  public simulatePartnerTouch(roomId: string, currentUserId: string, partnerName: string = 'Partner') {
    const partnerTouch: TouchData = {
      timestamp: Date.now(),
      sender: `partner_${roomId}`,
      senderName: partnerName,
    };

    if (this.isConfigured && this.database) {
      const touchRef = ref(this.database, `rooms/${roomId}/touch`);
      set(touchRef, partnerTouch);
      return;
    }

    const channelKey = `touch_${roomId}`;
    const listeners = this.simulatedListeners.get(channelKey) || [];
    listeners.forEach((cb) => cb(partnerTouch));
  }

  // Trigger simulated partner message
  public simulatePartnerMessage(
    roomId: string,
    currentUserId: string,
    text: string,
    partnerName: string = 'Partner'
  ) {
    const msgPayload = {
      text,
      sender: `partner_${roomId}`,
      senderName: partnerName,
      timestamp: Date.now(),
    };

    if (this.isConfigured && this.database) {
      const messagesRef = ref(this.database, `rooms/${roomId}/messages`);
      push(messagesRef, msgPayload);
      return;
    }

    const stored = this.getSimulatedMessages(roomId);
    const newMsg: ChatMessage = {
      id: `partner_msg_${Date.now()}`,
      ...msgPayload,
    };
    stored.push(newMsg);
    this.saveSimulatedMessages(roomId, stored);

    const channelKey = `messages_${roomId}`;
    const listeners = this.simulatedListeners.get(channelKey) || [];
    listeners.forEach((cb) => cb([...stored]));
  }
}

const syncService = new FirebaseSyncService();

// ============================================================================
// SINGLE FLOATING HEART COMPONENT
// ============================================================================
const FloatingHeart: React.FC<{
  item: FloatingHeartItem;
  onComplete: (id: string) => void;
}> = ({ item, onComplete }) => {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Fade out and drift upwards over 1.6 seconds (1600ms)
    Animated.timing(anim, {
      toValue: 1,
      duration: 1600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start(() => {
      onComplete(item.id);
    });
  }, []);

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -170],
  });

  const translateX = anim.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0, item.drift, item.drift * 1.6],
  });

  const opacity = anim.interpolate({
    inputRange: [0, 0.15, 0.75, 1],
    outputRange: [0, 1, 0.85, 0],
  });

  const scale = anim.interpolate({
    inputRange: [0, 0.2, 0.8, 1],
    outputRange: [0.5, 1.3, 1.0, 0.6],
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.floatingHeartContainer,
        {
          left: '50%',
          marginLeft: item.xOffset - item.size / 2,
          bottom: 70,
          opacity,
          transform: [{ translateY }, { translateX }, { scale }],
        },
      ]}
    >
      <Ionicons name="heart" size={item.size} color={item.color} />
    </Animated.View>
  );
};

// ============================================================================
// MAIN APPLICATION COMPONENT
// ============================================================================
export default function App() {
  // Preload Icon Fonts
  const [fontsLoaded] = useFonts({
    ...Ionicons.font,
  });

  // Global App States
  const [isInitializing, setIsInitializing] = useState<boolean>(true);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>('');
  const [userName, setUserName] = useState<string>('My Love');

  // Login Form States
  const [roomInput, setRoomInput] = useState<string>('');
  const [nameInput, setNameInput] = useState<string>('');
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [connectError, setConnectError] = useState<string>('');

  // Dashboard Heart States & Animations
  const [statusText, setStatusText] = useState<string>('Touch the Heart');
  const [floatingHearts, setFloatingHearts] = useState<FloatingHeartItem[]>([]);
  const heartScaleAnim = useRef(new Animated.Value(1)).current;
  const idlePulseAnim = useRef(new Animated.Value(1)).current;
  const statusTimerRef = useRef<any>(null);
  const longPressIntervalRef = useRef<any>(null);
  const isHoldingRef = useRef<boolean>(false);
  const lastProcessedTouchTimestampRef = useRef<number>(0);

  // Chat States
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const flatListRef = useRef<FlatList<ChatMessage>>(null);

  // UI Modals & Info
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [copiedBadgeToast, setCopiedBadgeToast] = useState<boolean>(false);
  const [showPartnerSimDrawer, setShowPartnerSimDrawer] = useState<boolean>(false);

  // Logo support with require('./logo.png')
  let logoSource: any = null;
  try {
    logoSource = require('./logo.png');
  } catch (err) {
    logoSource = null;
  }
  const [logoLoadFailed, setLogoLoadFailed] = useState<boolean>(false);

  // --------------------------------------------------------------------------
  // 1. INITIALIZATION & LOCAL PERSISTENCE RECOVERY
  // --------------------------------------------------------------------------
  useEffect(() => {
    const initializeFarLove = async () => {
      try {
        // Load saved credentials from AsyncStorage
        const [savedRoomId, savedUserId, savedUserName] = await Promise.all([
          AsyncStorage.getItem(STORAGE_ROOM_ID),
          AsyncStorage.getItem(STORAGE_USER_ID),
          AsyncStorage.getItem(STORAGE_USER_NAME),
        ]);

        let finalUserId = savedUserId;
        if (!finalUserId) {
          finalUserId = `user_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
          await AsyncStorage.setItem(STORAGE_USER_ID, finalUserId);
        }
        setUserId(finalUserId);

        if (savedUserName) {
          setUserName(savedUserName);
          setNameInput(savedUserName);
        }

        // Authenticate anonymously
        const authUid = await syncService.authenticateAnonymously(finalUserId);
        if (authUid && authUid !== finalUserId) {
          setUserId(authUid);
          await AsyncStorage.setItem(STORAGE_USER_ID, authUid);
        }

        // Auto-reconnect if returning user has a stored Room ID
        if (savedRoomId && savedRoomId.trim().length > 0) {
          setCurrentRoomId(savedRoomId.trim());
          setRoomInput(savedRoomId.trim());
        }
      } catch (err) {
        console.warn('[FarLove] Initialization error:', err);
      } finally {
        setTimeout(() => {
          setIsInitializing(false);
        }, 600);
      }
    };

    initializeFarLove();
  }, []);

  // --------------------------------------------------------------------------
  // 2. IDLE BREATHING ANIMATION ON HEART
  // --------------------------------------------------------------------------
  useEffect(() => {
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(idlePulseAnim, {
          toValue: 1.08,
          duration: 1700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(idlePulseAnim, {
          toValue: 1,
          duration: 1700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ])
    );
    breathing.start();
    return () => breathing.stop();
  }, []);

  // --------------------------------------------------------------------------
  // 3. SPRING SCALE BOUNCE ANIMATION TRIGGER
  // --------------------------------------------------------------------------
  const triggerHeartBounce = useCallback(() => {
    Animated.sequence([
      Animated.spring(heartScaleAnim, {
        toValue: 1.34,
        friction: 3,
        tension: 180,
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.spring(heartScaleAnim, {
        toValue: 1,
        friction: 4,
        tension: 120,
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]).start();
  }, [heartScaleAnim]);

  // --------------------------------------------------------------------------
  // 4. SPAWN FLOATING HEARTS
  // --------------------------------------------------------------------------
  const spawnHearts = useCallback((count: number = 3, colors?: string[]) => {
    const palette = colors || [
      THEME.heartRed,
      '#FF6B8B',
      THEME.primaryGold,
      '#FFAAA6',
      '#E85D75',
    ];
    const newItems: FloatingHeartItem[] = [];

    for (let i = 0; i < count; i++) {
      newItems.push({
        id: `heart_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        xOffset: (Math.random() - 0.5) * 80,
        size: Math.floor(Math.random() * 12) + 18,
        drift: (Math.random() - 0.5) * 60,
        color: palette[Math.floor(Math.random() * palette.length)],
      });
    }

    setFloatingHearts((prev) => [...prev.slice(-18), ...newItems]);
  }, []);

  const removeFloatingHeart = useCallback((id: string) => {
    setFloatingHearts((prev) => prev.filter((h) => h.id !== id));
  }, []);

  // Helper to set temporary status text with auto-reset to "Touch the Heart"
  const setStatusWithTimeout = useCallback((text: string, durationMs: number = 3000) => {
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
    }
    setStatusText(text);
    statusTimerRef.current = setTimeout(() => {
      setStatusText('Touch the Heart');
    }, durationMs);
  }, []);

  // --------------------------------------------------------------------------
  // 5. PARTNER TOUCH REACTION LISTENER
  // An onValue listener watches rooms/{roomId}/touch
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!currentRoomId || !userId) return;

    const unsubscribeTouch = syncService.listenToTouch(currentRoomId, (touchData) => {
      if (!touchData || !touchData.timestamp) return;

      const isFromPartner = touchData.sender !== userId;
      const ageMs = Date.now() - touchData.timestamp;

      // Check if touch from partner arrives within 10 seconds
      if (isFromPartner && ageMs >= 0 && ageMs < 10000) {
        if (touchData.timestamp !== lastProcessedTouchTimestampRef.current) {
          lastProcessedTouchTimestampRef.current = touchData.timestamp;

          // 1. Spring scale bounce animation
          triggerHeartBounce();

          // 2. Spawn upward floating hearts
          spawnHearts(5, ['#E85D75', '#FF758F', '#C99E5C', '#D9455F']);

          // 3. Vibration pattern [0, 250, 100, 250]
          triggerVibration([0, 250, 100, 250]);

          // 4. Sets status to "Avar ninne orkkunnu... ❤️" with 3-sec auto-reset
          setStatusWithTimeout('Avar ninne orkkunnu... ❤️', 3000);
        }
      }
    });

    return () => {
      unsubscribeTouch();
    };
  }, [currentRoomId, userId, triggerHeartBounce, spawnHearts, setStatusWithTimeout]);

  // --------------------------------------------------------------------------
  // 6. REALTIME CHAT MESSAGES LISTENER
  // --------------------------------------------------------------------------
  useEffect(() => {
    if (!currentRoomId) return;

    const unsubscribeMessages = syncService.listenToMessages(currentRoomId, (newMessages) => {
      setMessages(newMessages);
      // Auto-scroll to bottom when new messages arrive
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 120);
    });

    return () => {
      unsubscribeMessages();
    };
  }, [currentRoomId]);

  // --------------------------------------------------------------------------
  // 7. SINGLE TAP TOUCH HANDLER
  // --------------------------------------------------------------------------
  const handleSingleHeartTap = useCallback(() => {
    if (!currentRoomId) return;

    // 1. Spring scale bounce animation
    triggerHeartBounce();

    // 2. Custom animated mini floating hearts drifting upwards & fading over 1.6s
    spawnHearts(3);

    // 3. Vibrates device on tap (60ms)
    triggerVibration(60);

    // 4. Writes touch timestamp to rooms/{roomId}/touch in Firebase
    syncService.sendTouch(currentRoomId, userId, userName);

    // 5. Sets status to "Heart sent! ❤️" with 3-second auto-reset
    setStatusWithTimeout('Heart sent! ❤️', 3000);
  }, [currentRoomId, userId, userName, triggerHeartBounce, spawnHearts, setStatusWithTimeout]);

  // --------------------------------------------------------------------------
  // 8. LONG PRESS (HOLD) HANDLER
  // --------------------------------------------------------------------------
  const handleHeartPressIn = useCallback(() => {
    isHoldingRef.current = false;

    // Start hold timer: if held for > 350ms, enters continuous long press mode
    longPressIntervalRef.current = setTimeout(() => {
      isHoldingRef.current = true;
      setStatusText('Holding our hearts together... ❤️');

      // Continuous loop every 300ms until released
      const loop = () => {
        if (!isHoldingRef.current || !currentRoomId) return;

        // Subtle haptic pulse
        triggerVibration(40);

        // Emit floating heart
        spawnHearts(2);

        // Spring bounce
        triggerHeartBounce();

        // Repeated touch update to Firebase every 300ms
        syncService.sendTouch(currentRoomId, userId, userName);

        longPressIntervalRef.current = setTimeout(loop, 300);
      };

      loop();
    }, 350) as any;
  }, [currentRoomId, userId, userName, spawnHearts, triggerHeartBounce]);

  const handleHeartPressOut = useCallback(() => {
    if (longPressIntervalRef.current) {
      clearTimeout(longPressIntervalRef.current);
      longPressIntervalRef.current = null;
    }

    if (isHoldingRef.current) {
      isHoldingRef.current = false;
      spawnHearts(4);
      triggerVibration(60);
      setStatusWithTimeout('Heart sent! ❤️', 3000);
    }
  }, [spawnHearts, setStatusWithTimeout]);

  // --------------------------------------------------------------------------
  // 9. CONNECT TO ROOM HANDLER
  // --------------------------------------------------------------------------
  const handleConnectRoom = async () => {
    const cleanedRoom = roomInput.trim().toLowerCase();
    if (!cleanedRoom) {
      setConnectError('Please enter a room code (e.g. love123)');
      return;
    }
    setConnectError('');
    setIsConnecting(true);

    try {
      const trimmedName = nameInput.trim() || 'My Love';
      setUserName(trimmedName);

      // Persist Room ID and User ID locally via AsyncStorage
      await AsyncStorage.setItem(STORAGE_ROOM_ID, cleanedRoom);
      await AsyncStorage.setItem(STORAGE_USER_NAME, trimmedName);
      if (userId) {
        await AsyncStorage.setItem(STORAGE_USER_ID, userId);
      }

      setCurrentRoomId(cleanedRoom);
    } catch (err) {
      setConnectError('Could not save room connection. Please try again.');
    } finally {
      setIsConnecting(false);
    }
  };

  // --------------------------------------------------------------------------
  // 10. DISCONNECT / EXIT HANDLER
  // Clears local storage and returns to connect screen
  // --------------------------------------------------------------------------
  const handleDisconnect = async () => {
    try {
      // Clear Room ID from local storage so returning doesn't auto-connect
      await AsyncStorage.removeItem(STORAGE_ROOM_ID);
      setCurrentRoomId(null);
      setMessages([]);
      setStatusText('Touch the Heart');
    } catch (err) {
      console.warn('[FarLove] Disconnect error:', err);
    }
  };

  // --------------------------------------------------------------------------
  // 11. SEND CHAT MESSAGE HANDLER
  // Pushes messages to rooms/{roomId}/messages
  // --------------------------------------------------------------------------
  const handleSendMessage = async (textToSend?: string) => {
    const rawText = textToSend !== undefined ? textToSend : inputText;
    const trimmed = rawText.trim();
    if (!trimmed || !currentRoomId) return;

    setInputText('');
    setIsSending(true);

    try {
      await syncService.sendMessage(currentRoomId, trimmed, userId, userName);
    } catch (err) {
      console.warn('[FarLove] Send message error:', err);
    } finally {
      setIsSending(false);
    }
  };

  // --------------------------------------------------------------------------
  // 12. COPY ROOM CODE HELPER
  // --------------------------------------------------------------------------
  const handleCopyRoomCode = () => {
    if (!currentRoomId) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(currentRoomId);
    }
    setCopiedBadgeToast(true);
    triggerVibration(40);
    setTimeout(() => {
      setCopiedBadgeToast(false);
    }, 2000);
  };

  // Quick whisper romantic presets
  const quickWhispers = [
    'I miss you ❤️',
    'Thinking of you ✨',
    'Sending warm hugs 🫂',
    'Counting the moments ⏳',
    'Forever yours 🕊️',
  ];

  // --------------------------------------------------------------------------
  // LOADING / INITIALIZATION SCREEN
  // --------------------------------------------------------------------------
  if (!fontsLoaded || isInitializing) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style="dark" />
        <View style={styles.loadingCard}>
          <Ionicons name="heart" size={56} color={THEME.primaryGold} />
          <Text style={styles.loadingTitle}>FarLove</Text>
          <Text style={styles.loadingSubtitle}>Connecting two hearts across the distance...</Text>
          <ActivityIndicator size="large" color={THEME.primaryGold} style={{ marginTop: 24 }} />
        </View>
      </View>
    );
  }

  // --------------------------------------------------------------------------
  // SCREEN 1: LOGIN / CONNECT ROOM SCREEN
  // --------------------------------------------------------------------------
  if (!currentRoomId) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safeArea}>
          <StatusBar style="dark" />
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardContainer}
          >
            <ScrollView
              contentContainerStyle={styles.loginScrollContent}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.loginCenterWrapper}>
                {/* Brand Logo & Header */}
                <View style={styles.brandHeader}>
                  <View style={styles.logoHalo}>
                    {logoSource && !logoLoadFailed ? (
                      <Image
                        source={logoSource}
                        style={styles.logoImage}
                        resizeMode="contain"
                        onError={() => setLogoLoadFailed(true)}
                      />
                    ) : (
                      <View style={styles.fallbackLogoContainer}>
                        <Ionicons name="heart" size={48} color={THEME.primaryGold} />
                        <View style={styles.fallbackSparkle}>
                          <Ionicons name="sparkles" size={18} color="#D9455F" />
                        </View>
                      </View>
                    )}
                  </View>
                  <Text style={styles.brandTitle}>FarLove</Text>
                  <Text style={styles.brandSlogan}>Across any distance, still one heartbeat</Text>
                </View>

                {/* Connect Card */}
                <View style={styles.connectCard}>
                  <Text style={styles.connectCardTitle}>Join Your Couple Room</Text>
                  <Text style={styles.connectCardSubtitle}>
                    Enter the same secret code as your partner to touch hearts and whisper live.
                  </Text>

                  {/* Room Code Input */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>ROOM CODE</Text>
                    <View style={styles.inputWrapper}>
                      <Ionicons
                        name="key-outline"
                        size={20}
                        color={THEME.primaryGold}
                        style={styles.inputIcon}
                      />
                      <TextInput
                        style={styles.textInput}
                        placeholder="e.g. love123"
                        placeholderTextColor={THEME.textSecondary}
                        value={roomInput}
                        onChangeText={(txt) => {
                          setRoomInput(txt);
                          setConnectError('');
                        }}
                        autoCapitalize="none"
                        autoCorrect={false}
                        returnKeyType="next"
                      />
                    </View>
                  </View>

                  {/* Room Code Quick Suggestions */}
                  <View style={styles.presetChipsRow}>
                    <Text style={styles.presetLabel}>Quick ideas:</Text>
                    {['love123', 'sweetheart', 'forever-us'].map((code) => (
                      <TouchableOpacity
                        key={code}
                        style={styles.presetChip}
                        onPress={() => setRoomInput(code)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.presetChipText}>{code}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Nickname Input */}
                  <View style={[styles.inputGroup, { marginTop: 14 }]}>
                    <Text style={styles.inputLabel}>YOUR SWEET NAME (OPTIONAL)</Text>
                    <View style={styles.inputWrapper}>
                      <Ionicons
                        name="person-outline"
                        size={20}
                        color={THEME.primaryGold}
                        style={styles.inputIcon}
                      />
                      <TextInput
                        style={styles.textInput}
                        placeholder="Darling, Honey, My Love..."
                        placeholderTextColor={THEME.textSecondary}
                        value={nameInput}
                        onChangeText={setNameInput}
                        autoCapitalize="words"
                        returnKeyType="done"
                      />
                    </View>
                  </View>

                  {connectError ? <Text style={styles.errorText}>{connectError}</Text> : null}

                  {/* Connect Button */}
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={handleConnectRoom}
                    disabled={isConnecting}
                    activeOpacity={0.85}
                  >
                    {isConnecting ? (
                      <ActivityIndicator color="#FFFFFF" size="small" />
                    ) : (
                      <View style={styles.buttonContentRow}>
                        <Ionicons name="heart" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
                        <Text style={styles.primaryButtonText}>Connect Hearts</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>

                {/* Realtime Backend Status Footer */}
                <View style={styles.loginFooterBadge}>
                  <Ionicons
                    name={syncService.isLiveMode() ? 'cloud-done-outline' : 'wifi-outline'}
                    size={16}
                    color={syncService.isLiveMode() ? THEME.success : THEME.primaryGold}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={styles.loginFooterBadgeText}>
                    {syncService.isLiveMode()
                      ? 'Live Firebase WebSockets Ready'
                      : 'Realtime WebSocket Sync Ready (Local/Live fallback)'}
                  </Text>
                </View>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  // --------------------------------------------------------------------------
  // SCREEN 2: MAIN DASHBOARD & REALTIME CHAT
  // --------------------------------------------------------------------------
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />

        {/* TOP BAR / HEADER */}
        <View style={styles.headerBar}>
          {/* Left Brand Identity */}
          <View style={styles.headerLeft}>
            <Ionicons name="heart" size={22} color={THEME.heartRed} />
            <Text style={styles.headerBrandText}>FarLove</Text>
          </View>

          {/* Center Badge with Room ID */}
          <TouchableOpacity
            style={styles.roomBadgeContainer}
            onPress={handleCopyRoomCode}
            activeOpacity={0.75}
          >
            <View style={styles.liveDot} />
            <Text style={styles.roomBadgeText}>#{currentRoomId}</Text>
            <Ionicons
              name={copiedBadgeToast ? 'checkmark-outline' : 'copy-outline'}
              size={14}
              color={copiedBadgeToast ? THEME.success : THEME.textSecondary}
              style={{ marginLeft: 4 }}
            />
          </TouchableOpacity>

          {/* Right Controls: Sim Partner + Exit / Disconnect */}
          <View style={styles.headerRight}>
            <TouchableOpacity
              style={styles.simPartnerHeaderBtn}
              onPress={() => setShowPartnerSimDrawer(!showPartnerSimDrawer)}
              activeOpacity={0.7}
              accessibilityLabel="Partner Simulator"
            >
              <Ionicons name="options-outline" size={18} color={THEME.textPrimary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.exitButton}
              onPress={handleDisconnect}
              activeOpacity={0.75}
              accessibilityLabel="Exit / Disconnect Room"
            >
              <Ionicons name="log-out-outline" size={18} color={THEME.primaryGold} />
              <Text style={styles.exitButtonText}>Exit</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Copied toast feedback */}
        {copiedBadgeToast ? (
          <View style={styles.toastContainer}>
            <Text style={styles.toastText}>Room code #{currentRoomId} copied to clipboard! 💕</Text>
          </View>
        ) : null}

        {/* Partner Simulation Drawer / Tools */}
        {showPartnerSimDrawer ? (
          <View style={styles.partnerSimDrawer}>
            <View style={styles.drawerHeader}>
              <Text style={styles.drawerTitle}>Relationship Testing Tools</Text>
              <TouchableOpacity onPress={() => setShowPartnerSimDrawer(false)}>
                <Ionicons name="close-circle-outline" size={20} color={THEME.textSecondary} />
              </TouchableOpacity>
            </View>
            <Text style={styles.drawerSubtitle}>
              Simulate your partner's interactions from a single screen:
            </Text>
            <View style={styles.drawerButtonsRow}>
              <TouchableOpacity
                style={styles.drawerActionBtn}
                onPress={() => {
                  syncService.simulatePartnerTouch(currentRoomId, userId, 'My Darling');
                  setShowPartnerSimDrawer(false);
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="heart-circle" size={18} color={THEME.heartRed} style={{ marginRight: 6 }} />
                <Text style={styles.drawerActionBtnText}>Simulate Partner Touch</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.drawerActionBtn, { borderColor: THEME.primaryGold }]}
                onPress={() => {
                  const msgs = [
                    'Thinking of you right now... ❤️',
                    'I felt your heartbeat! ✨',
                    'Miss you so much darling 🫂',
                    'Avar ninne orkkunnu... ❤️',
                  ];
                  const pick = msgs[Math.floor(Math.random() * msgs.length)];
                  syncService.simulatePartnerMessage(currentRoomId, userId, pick, 'Partner');
                  setShowPartnerSimDrawer(false);
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="chatbubble-ellipses" size={18} color={THEME.primaryGold} style={{ marginRight: 6 }} />
                <Text style={styles.drawerActionBtnText}>Simulate Partner Chat</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* MAIN INTERACTIVE CORE: PROMINENT LIVE HEART TOUCH AREA */}
        <View style={styles.heartSectionContainer}>
          {/* Status Text (3-second auto-reset back to 'Touch the Heart') */}
          <View style={styles.statusBadge}>
            <Text
              style={[
                styles.statusText,
                statusText.includes('Avar ninne orkkunnu')
                  ? styles.statusTextPartnerSpecial
                  : statusText.includes('sent')
                  ? styles.statusTextSuccess
                  : null,
              ]}
            >
              {statusText}
            </Text>
          </View>

          {/* Centered Large Heart Touch Target */}
          <View style={styles.heartWrapper}>
            {/* Ambient Animated Radial Halo Rings */}
            <Animated.View
              style={[
                styles.ambientHaloRing,
                {
                  transform: [{ scale: idlePulseAnim }],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.ambientInnerRing,
                {
                  transform: [{ scale: Animated.multiply(idlePulseAnim, 1.04) }],
                },
              ]}
            />

            {/* Custom Mini Floating Hearts drifting upwards over 1.6s */}
            {floatingHearts.map((item) => (
              <FloatingHeart key={item.id} item={item} onComplete={removeFloatingHeart} />
            ))}

            {/* The Interactive Heart Element with Spring scale bounce */}
            <TouchableWithoutFeedback
              onPress={handleSingleHeartTap}
              onPressIn={handleHeartPressIn}
              onPressOut={handleHeartPressOut}
            >
              <Animated.View
                style={[
                  styles.heartCircleButton,
                  {
                    transform: [{ scale: heartScaleAnim }],
                  },
                ]}
              >
                <Ionicons name="heart" size={72} color={THEME.heartRed} />
              </Animated.View>
            </TouchableWithoutFeedback>
          </View>

          {/* Touch gesture hint */}
          <Text style={styles.heartInstructionHint}>
            Tap to send love • Hold for continuous warmth
          </Text>
        </View>

        {/* SEPARATOR */}
        <View style={styles.sectionDivider}>
          <View style={styles.dividerLine} />
          <View style={styles.dividerHeart}>
            <Ionicons name="sparkles" size={14} color={THEME.primaryGold} />
          </View>
          <View style={styles.dividerLine} />
        </View>

        {/* CORE FEATURE: REALTIME LIVE CHAT */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
          style={styles.chatSection}
        >
          {/* Scrollable FlatList for Chat Messages */}
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.messagesListContent}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            ListEmptyComponent={
              <View style={styles.emptyChatPlaceholder}>
                <Ionicons name="chatbubbles-outline" size={36} color={THEME.border} />
                <Text style={styles.emptyChatText}>
                  No whispers yet in room #{currentRoomId}.
                </Text>
                <Text style={styles.emptyChatSubtext}>
                  Send your first sweet message or touch the heart above!
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const isMe = item.sender === userId;
              const timeString = item.timestamp
                ? new Date(item.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '';

              return (
                <View
                  style={[
                    styles.messageRow,
                    isMe ? styles.messageRowMe : styles.messageRowPartner,
                  ]}
                >
                  <View
                    style={[
                      styles.messageBubble,
                      isMe ? styles.userBubble : styles.partnerBubble,
                    ]}
                  >
                    {!isMe && item.senderName ? (
                      <Text style={styles.senderLabel}>{item.senderName}</Text>
                    ) : null}
                    <Text
                      style={[
                        styles.messageText,
                        isMe ? styles.userMessageText : styles.partnerMessageText,
                      ]}
                    >
                      {item.text}
                    </Text>
                    <Text
                      style={[
                        styles.messageTime,
                        isMe ? styles.userTimeText : styles.partnerTimeText,
                      ]}
                    >
                      {timeString}
                    </Text>
                  </View>
                </View>
              );
            }}
          />

          {/* Quick Romantic Whispers Bar */}
          <View style={styles.quickWhispersRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.quickWhispersScroll}
            >
              {quickWhispers.map((phrase, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.whisperChip}
                  onPress={() => handleSendMessage(phrase)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.whisperChipText}>{phrase}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          {/* Message Input Bar pinned at bottom */}
          <View style={styles.inputBarContainer}>
            <TextInput
              style={styles.chatTextInput}
              placeholder="Whisper something sweet..."
              placeholderTextColor={THEME.textSecondary}
              value={inputText}
              onChangeText={setInputText}
              multiline={false}
              returnKeyType="send"
              onSubmitEditing={() => handleSendMessage()}
            />

            <TouchableOpacity
              style={[
                styles.sendButton,
                !inputText.trim() && styles.sendButtonDisabled,
              ]}
              onPress={() => handleSendMessage()}
              disabled={!inputText.trim() || isSending}
              activeOpacity={0.8}
            >
              {isSending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

// ============================================================================
// STYLES
// Warm, minimal, premium romantic aesthetic
// ============================================================================
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: THEME.background,
  },
  keyboardContainer: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: THEME.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 32,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: THEME.border,
    shadowColor: THEME.primaryGold,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 4,
    maxWidth: 360,
    width: '100%',
  },
  loadingTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: THEME.textPrimary,
    marginTop: 12,
    letterSpacing: 0.5,
  },
  loadingSubtitle: {
    fontSize: 14,
    color: THEME.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },

  // --------------------------------------------------------------------------
  // LOGIN / CONNECT SCREEN STYLES
  // --------------------------------------------------------------------------
  loginScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 32,
  },
  loginCenterWrapper: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 28,
  },
  logoHalo: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: THEME.border,
    shadowColor: THEME.primaryGold,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 5,
    marginBottom: 14,
  },
  logoImage: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  fallbackLogoContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  fallbackSparkle: {
    position: 'absolute',
    top: -4,
    right: -6,
  },
  brandTitle: {
    fontSize: 34,
    fontWeight: '800',
    color: THEME.textPrimary,
    letterSpacing: 0.8,
  },
  brandSlogan: {
    fontSize: 14,
    color: THEME.textSecondary,
    marginTop: 6,
    letterSpacing: 0.2,
  },
  connectCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: THEME.border,
    shadowColor: '#4A2E18',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 3,
  },
  connectCardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: THEME.textPrimary,
    marginBottom: 6,
  },
  connectCardSubtitle: {
    fontSize: 13,
    color: THEME.textSecondary,
    lineHeight: 18,
    marginBottom: 20,
  },
  inputGroup: {
    marginBottom: 10,
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: THEME.textSecondary,
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.background,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: THEME.border,
    paddingHorizontal: 14,
    height: 50,
  },
  inputIcon: {
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    color: THEME.textPrimary,
    paddingVertical: 0,
  },
  presetChipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 8,
    marginBottom: 6,
    gap: 6,
  },
  presetLabel: {
    fontSize: 12,
    color: THEME.textSecondary,
    marginRight: 2,
  },
  presetChip: {
    backgroundColor: THEME.chipBg,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  presetChipText: {
    fontSize: 11,
    color: THEME.textPrimary,
    fontWeight: '600',
  },
  errorText: {
    color: THEME.heartRed,
    fontSize: 12,
    marginTop: 10,
    marginBottom: 6,
    fontWeight: '500',
  },
  primaryButton: {
    backgroundColor: THEME.primaryGold,
    borderRadius: 16,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 18,
    shadowColor: THEME.primaryGold,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 3,
  },
  buttonContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  loginFooterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 22,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: THEME.border,
  },
  loginFooterBadgeText: {
    fontSize: 11,
    color: THEME.textSecondary,
    fontWeight: '500',
  },

  // --------------------------------------------------------------------------
  // MAIN DASHBOARD & HEADER STYLES
  // --------------------------------------------------------------------------
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
    backgroundColor: '#FFFFFF',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerBrandText: {
    fontSize: 18,
    fontWeight: '800',
    color: THEME.textPrimary,
    marginLeft: 6,
    letterSpacing: 0.4,
  },
  roomBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.chipBg,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: THEME.success,
    marginRight: 6,
  },
  roomBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: THEME.textPrimary,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  simPartnerHeaderBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: THEME.chipBg,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: THEME.border,
  },
  exitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: THEME.chipBg,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  exitButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.primaryGold,
    marginLeft: 3,
  },
  toastContainer: {
    backgroundColor: THEME.primaryGold,
    paddingVertical: 6,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },

  // --------------------------------------------------------------------------
  // PARTNER SIMULATION DRAWER
  // --------------------------------------------------------------------------
  partnerSimDrawer: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: THEME.border,
  },
  drawerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  drawerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: THEME.textPrimary,
  },
  drawerSubtitle: {
    fontSize: 11,
    color: THEME.textSecondary,
    marginBottom: 10,
  },
  drawerButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  drawerActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: THEME.background,
    borderWidth: 1,
    borderColor: THEME.heartRed,
  },
  drawerActionBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: THEME.textPrimary,
  },

  // --------------------------------------------------------------------------
  // CORE FEATURE: HEART TOUCH AREA STYLES
  // --------------------------------------------------------------------------
  heartSectionContainer: {
    alignItems: 'center',
    paddingVertical: 16,
    position: 'relative',
  },
  statusBadge: {
    paddingHorizontal: 18,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: THEME.border,
    marginBottom: 14,
    shadowColor: THEME.primaryGold,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME.textPrimary,
    letterSpacing: 0.2,
  },
  statusTextSuccess: {
    color: THEME.heartRed,
    fontWeight: '700',
  },
  statusTextPartnerSpecial: {
    color: THEME.heartRed,
    fontWeight: '800',
  },
  heartWrapper: {
    width: 170,
    height: 170,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  ambientHaloRing: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(217, 69, 95, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(217, 69, 95, 0.18)',
  },
  ambientInnerRing: {
    position: 'absolute',
    width: 136,
    height: 136,
    borderRadius: 68,
    backgroundColor: 'rgba(201, 158, 92, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(201, 158, 92, 0.22)',
  },
  heartCircleButton: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: THEME.heartRed,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 18,
    elevation: 7,
    borderWidth: 1.5,
    borderColor: 'rgba(217, 69, 95, 0.25)',
  },
  heartInstructionHint: {
    fontSize: 11,
    color: THEME.textSecondary,
    marginTop: 10,
    letterSpacing: 0.3,
  },
  floatingHeartContainer: {
    position: 'absolute',
    zIndex: 99,
  },

  // --------------------------------------------------------------------------
  // DIVIDER
  // --------------------------------------------------------------------------
  sectionDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: THEME.border,
  },
  dividerHeart: {
    paddingHorizontal: 10,
  },

  // --------------------------------------------------------------------------
  // CORE FEATURE: LIVE CHAT STYLES
  // --------------------------------------------------------------------------
  chatSection: {
    flex: 1,
    justifyContent: 'space-between',
  },
  messagesListContent: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexGrow: 1,
  },
  emptyChatPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 36,
  },
  emptyChatText: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME.textPrimary,
    marginTop: 10,
  },
  emptyChatSubtext: {
    fontSize: 12,
    color: THEME.textSecondary,
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 30,
  },
  messageRow: {
    marginVertical: 4,
    flexDirection: 'row',
    width: '100%',
  },
  messageRowMe: {
    justifyContent: 'flex-end',
  },
  messageRowPartner: {
    justifyContent: 'flex-start',
  },
  messageBubble: {
    maxWidth: '78%',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  userBubble: {
    backgroundColor: THEME.userBubble, // Warm muted gold / caramel (#C99E5C)
    borderBottomRightRadius: 4,
  },
  partnerBubble: {
    backgroundColor: THEME.partnerBubble, // Soft beige/sand (#EFEBE4)
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: THEME.border,
  },
  senderLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: THEME.primaryGold,
    marginBottom: 2,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 19,
  },
  userMessageText: {
    color: THEME.userText, // Pure white
  },
  partnerMessageText: {
    color: THEME.partnerText, // Deep warm brown (#4A2E18)
  },
  messageTime: {
    fontSize: 10,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  userTimeText: {
    color: 'rgba(255, 255, 255, 0.75)',
  },
  partnerTimeText: {
    color: THEME.textSecondary,
  },

  // Quick Whispers
  quickWhispersRow: {
    paddingVertical: 6,
    backgroundColor: THEME.background,
    borderTopWidth: 1,
    borderTopColor: THEME.border,
  },
  quickWhispersScroll: {
    paddingHorizontal: 12,
    gap: 6,
  },
  whisperChip: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: THEME.border,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
  },
  whisperChipText: {
    fontSize: 12,
    color: THEME.textPrimary,
    fontWeight: '500',
  },

  // Message Input Bar
  inputBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: THEME.border,
  },
  chatTextInput: {
    flex: 1,
    backgroundColor: THEME.background,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    color: THEME.textPrimary,
    borderWidth: 1,
    borderColor: THEME.border,
    maxHeight: 90,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: THEME.primaryGold,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
    shadowColor: THEME.primaryGold,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  sendButtonDisabled: {
    backgroundColor: '#D1C8BF',
    shadowOpacity: 0,
    elevation: 0,
  },
});
