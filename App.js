import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Vibration,
  ActivityIndicator,
  Image,
  SafeAreaView,
  StatusBar
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  getDatabase,
  ref,
  set,
  push,
  onValue,
  off
} from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyC7IDnscYyotlddP1PzojBlA-obuNA-KOA",
  authDomain: "farlove-87fcb.firebaseapp.com",
  databaseURL: "https://farlove-87fcb-default-rtdb.firebaseio.com",
  projectId: "farlove-87fcb",
  storageBucket: "farlove-87fcb.firebasestorage.app",
  messagingSenderId: "257123943560",
  appId: "1:257123943560:web:37e9a5414ff9eaf1108b3d"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getDatabase(app);

const FloatingHeart = ({ id, onComplete }) => {
  const animY = useRef(new Animated.Value(0)).current;
  const animOpacity = useRef(new Animated.Value(1)).current;
  const animScale = useRef(new Animated.Value(0.6)).current;
  const randomX = useRef((Math.random() - 0.5) * 80).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(animY, {
        toValue: -140,
        duration: 1600,
        useNativeDriver: true
      }),
      Animated.timing(animOpacity, {
        toValue: 0,
        duration: 1600,
        useNativeDriver: true
      }),
      Animated.spring(animScale, {
        toValue: 1.2,
        friction: 4,
        useNativeDriver: true
      })
    ]).start(() => {
      if (onComplete) onComplete(id);
    });
  }, []);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.floatingHeart,
        {
          transform: [
            { translateY: animY },
            { translateX: randomX },
            { scale: animScale }
          ],
          opacity: animOpacity
        }
      ]}
    >
      <Text style={{ fontSize: 24 }}>❤️</Text>
    </Animated.View>
  );
};

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [roomId, setRoomId] = useState('');
  const [inputRoomCode, setInputRoomCode] = useState('');
  const [connected, setConnected] = useState(false);

  const [heartStatus, setHeartStatus] = useState("Touch the Heart");
  const [floatingHearts, setFloatingHearts] = useState([]);
  const heartScale = useRef(new Animated.Value(1)).current;
  const holdIntervalRef = useRef(null);
  const statusTimeoutRef = useRef(null);

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef(null);

  // മ്യൂസിക് പ്ലെയർ സ്റ്റേറ്റുകൾ
  const [sound, setSound] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(1);
  const [isLiked, setIsLiked] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const soundRef = useRef(null);

  useEffect(() => {
    let unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        await checkPersistedSession(user.uid);
      } else {
        try {
          const cred = await signInAnonymously(auth);
          setCurrentUser(cred.user);
          await checkPersistedSession(cred.user.uid);
        } catch (error) {
          console.error("Auth error:", error);
          setLoading(false);
        }
      }
    });

    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    }).catch((e) => console.log("Audio mode error:", e));

    const songDbRef = ref(db, 'songUrl');
    const unsubscribeSong = onValue(songDbRef, async (snapshot) => {
      const url = snapshot.val() || 'https://files.catbox.moe/2mp98q.mp3';

      try {
        if (soundRef.current) {
          await soundRef.current.unloadAsync();
        }
        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: url },
          { shouldPlay: false },
          onPlaybackStatusUpdate
        );
        soundRef.current = newSound;
        setSound(newSound);
      } catch (e) {
        console.log("Audio load error:", e);
      }
    });

    return () => {
      unsubscribeSong();
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
    };
  }, []);

  const onPlaybackStatusUpdate = (status) => {
    if (status.isLoaded) {
      setPosition(status.positionMillis);
      setDuration(status.durationMillis || 1);
      setIsPlaying(status.isPlaying);
      if (status.didJustFinish && !status.isLooping) {
        setIsPlaying(false);
      }
    }
  };

  // പ്ലേ / പോസ് കൃത്യമായി പ്രവർത്തിക്കാനുള്ള ഫംഗ്ഷൻ
  const togglePlayPause = async () => {
    if (!sound) return;
    try {
      const status = await sound.getStatusAsync();
      if (status.isLoaded) {
        if (status.isPlaying) {
          await sound.pauseAsync();
          setIsPlaying(false);
        } else {
          await sound.playAsync();
          setIsPlaying(true);
        }
      }
    } catch (error) {
      console.log("Error toggling playback:", error);
    }
  };

  const toggleLoop = async () => {
    if (!sound) return;
    const nextState = !isLooping;
    setIsLooping(nextState);
    await sound.setIsLoopingAsync(nextState);
  };

  const handleSlidingComplete = async (value) => {
    if (sound) {
      await sound.setPositionAsync(value);
    }
  };

  const formatTime = (millis) => {
    const totalSeconds = Math.floor(millis / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  };

  const checkPersistedSession = async (uid) => {
    try {
      const savedRoom = await AsyncStorage.getItem('@farlove_room_id');
      if (savedRoom) {
        setRoomId(savedRoom);
        setConnected(true);
      }
    } catch (e) {
      console.error("AsyncStorage error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!connected || !roomId || !currentUser) return;

    const touchRef = ref(db, `rooms/${roomId}/touch`);
    const touchListener = onValue(touchRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      const now = Date.now();
      const isPartner = data.senderId !== currentUser.uid;
      const isFresh = data.timestamp && (now - data.timestamp < 10000);

      if (isPartner && isFresh) {
        triggerSpringAnimation();
        spawnHeartParticle();
        Vibration.vibrate([0, 250, 100, 250]);
        showStatusText("Avar ninne orkkunnu... ❤️");
      }
    });

    const messagesRef = ref(db, `rooms/${roomId}/messages`);
    const messagesListener = onValue(messagesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const parsedMessages = Object.keys(data).map((key) => ({
          id: key,
          ...data[key]
        })).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        setMessages(parsedMessages);
      } else {
        setMessages([]);
      }
    });

    return () => {
      off(touchRef);
      off(messagesRef);
    };
  }, [connected, roomId, currentUser]);

  const handleConnect = async () => {
    const trimmed = inputRoomCode.trim().toLowerCase();
    if (!trimmed) return;
    try {
      await AsyncStorage.setItem('@farlove_room_id', trimmed);
      setRoomId(trimmed);
      setConnected(true);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDisconnect = async () => {
    try {
      await AsyncStorage.removeItem('@farlove_room_id');
      setConnected(false);
      setRoomId('');
      setInputRoomCode('');
      setMessages([]);
    } catch (e) {
      console.error(e);
    }
  };

  const triggerSpringAnimation = () => {
    Animated.sequence([
      Animated.spring(heartScale, {
        toValue: 1.25,
        friction: 3,
        useNativeDriver: true
      }),
      Animated.spring(heartScale, {
        toValue: 1,
        friction: 3,
        useNativeDriver: true
      })
    ]).start();
  };

  const spawnHeartParticle = () => {
    setFloatingHearts((prev) => [...prev, { id: Date.now() + Math.random() }]);
  };

  const removeHeartParticle = (id) => {
    setFloatingHearts((prev) => prev.filter((h) => h.id !== id));
  };

  const showStatusText = (text) => {
    setHeartStatus(text);
    if (statusTimeoutRef.current) clearTimeout(statusTimeoutRef.current);
    statusTimeoutRef.current = setTimeout(() => {
      setHeartStatus("Touch the Heart");
    }, 3000);
  };

  const sendTouch = () => {
    if (!roomId || !currentUser) return;
    triggerSpringAnimation();
    spawnHeartParticle();
    Vibration.vibrate(60);
    showStatusText("Heart sent! ❤️");

    set(ref(db, `rooms/${roomId}/touch`), {
      senderId: currentUser.uid,
      timestamp: Date.now()
    });
  };

  const handlePressIn = () => {
    sendTouch();
    holdIntervalRef.current = setInterval(() => {
      sendTouch();
    }, 300);
  };

  const handlePressOut = () => {
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  };

  const handleSendMessage = () => {
    const trimmed = inputText.trim();
    if (!trimmed || !roomId || !currentUser) return;

    const messagesRef = ref(db, `rooms/${roomId}/messages`);
    push(messagesRef, {
      text: trimmed,
      senderId: currentUser.uid,
      timestamp: Date.now()
    });
    setInputText('');
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#C99E5C" />
      </View>
    );
  }

  if (!connected) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.authContainer}>
          <Image
            source={require('./logo.png')}
            style={styles.authLogo}
            resizeMode="contain"
          />
          <Text style={styles.appTitle}>FarLove</Text>
          <Text style={styles.appSubtitle}>Distance means so little when someone means so much.</Text>

          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.roomInput}
              placeholder="Enter Room Code (e.g. love123)"
              placeholderTextColor="#A89F91"
              value={inputRoomCode}
              onChangeText={setInputRoomCode}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={styles.primaryButton} onPress={handleConnect}>
              <Text style={styles.primaryButtonText}>Connect</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <View style={styles.roomBadge}>
            <Text style={styles.roomBadgeText}>ROOM: {roomId.toUpperCase()}</Text>
          </View>
          <TouchableOpacity onPress={handleDisconnect} style={styles.disconnectButton}>
            <Text style={styles.disconnectText}>Exit</Text>
          </TouchableOpacity>
        </View>

        {/* ക്ലീൻ മിനിമൽ മ്യൂസിക് പ്ലെയർ */}
        <View style={styles.minimalPlayerCard}>
          <View style={styles.playerTopRow}>
            <TouchableOpacity onPress={() => setIsLiked(!isLiked)}>
              <Ionicons 
                name={isLiked ? "heart" : "heart-outline"} 
                size={20} 
                color={isLiked ? '#ef4444' : '#4A2E18'} 
              />
            </TouchableOpacity>
          </View>

          <Slider
            style={styles.playerSlider}
            minimumValue={0}
            maximumValue={duration}
            value={position}
            minimumTrackTintColor="#4A2E18"
            maximumTrackTintColor="#D1C7BD"
            thumbTintColor="#4A2E18"
            onSlidingComplete={handleSlidingComplete}
          />

          <View style={styles.timeRow}>
            <Text style={styles.timeText}>{formatTime(position)}</Text>
            <Text style={styles.timeText}>{formatTime(duration)}</Text>
          </View>

          <View style={styles.controlsRow}>
            {/* റിപ്പീറ്റ് ബട്ടൺ */}
            <TouchableOpacity onPress={toggleLoop} style={styles.iconBtn}>
              <Ionicons 
                name="repeat" 
                size={20} 
                color="#4A2E18" 
                style={isLooping ? styles.activeControl : styles.dimControl} 
              />
            </TouchableOpacity>

            {/* പ്രീവിയസ് ബട്ടൺ */}
            <TouchableOpacity onPress={() => sound && sound.setPositionAsync(0)} style={styles.iconBtn}>
              <Ionicons name="play-skip-back" size={20} color="#4A2E18" />
            </TouchableOpacity>

            {/* മെയിൻ പ്ലേ / പോസ് സർക്കിൾ ബട്ടൺ */}
            <TouchableOpacity 
              style={styles.circlePlayBtn} 
              onPress={togglePlayPause}
              activeOpacity={0.7}
            >
              <Ionicons 
                name={isPlaying ? "pause" : "play"} 
                size={22} 
                color="#FFFFFF" 
                style={!isPlaying ? { marginLeft: 3 } : {}}
              />
            </TouchableOpacity>

            {/* നെക്സ്റ്റ് ബട്ടൺ */}
            <TouchableOpacity onPress={() => sound && sound.setPositionAsync(duration)} style={styles.iconBtn}>
              <Ionicons name="play-skip-forward" size={20} color="#4A2E18" />
            </TouchableOpacity>

            {/* ഷഫിൾ ബട്ടൺ */}
            <TouchableOpacity style={styles.iconBtn}>
              <Ionicons 
                name="shuffle" 
                size={20} 
                color="#4A2E18" 
                style={styles.dimControl} 
              />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.heartSection}>
          <View style={styles.particleCanvas} pointerEvents="none">
            {floatingHearts.map((heart) => (
              <FloatingHeart
                key={heart.id}
                id={heart.id}
                onComplete={removeHeartParticle}
              />
            ))}
          </View>

          <TouchableOpacity
            activeOpacity={0.8}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
          >
            <Animated.View style={{ transform: [{ scale: heartScale }] }}>
              <Text style={styles.mainHeart}>❤️</Text>
            </Animated.View>
          </TouchableOpacity>
          <Text style={styles.statusLabel}>{heartStatus}</Text>
        </View>

        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          style={styles.chatList}
          contentContainerStyle={styles.chatContent}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => {
            const isUser = item.senderId === currentUser?.uid;
            return (
              <View
                style={[
                  styles.messageRow,
                  isUser ? styles.userRow : styles.partnerRow
                ]}
              >
                <View
                  style={[
                    styles.messageBubble,
                    isUser ? styles.userBubble : styles.partnerBubble
                  ]}
                >
                  <Text style={[styles.messageText, isUser ? styles.userMessageText : styles.partnerMessageText]}>
                    {item.text}
                  </Text>
                </View>
              </View>
            );
          }}
        />

        <View style={styles.inputContainer}>
          <TextInput
            style={styles.textInput}
            placeholder="Type a message..."
            placeholderTextColor="#7D6E65"
            value={inputText}
            onChangeText={setInputText}
          />
          <TouchableOpacity style={styles.sendButton} onPress={handleSendMessage}>
            <Text style={styles.sendButtonText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF9F6'
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAF9F6'
  },
  authContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30
  },
  authLogo: {
    width: 90,
    height: 90,
    marginBottom: 20
  },
  appTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#4A2E18',
    letterSpacing: 1.5,
    marginBottom: 8
  },
  appSubtitle: {
    fontSize: 14,
    color: '#7D6E65',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 36
  },
  inputWrapper: {
    width: '100%',
    alignItems: 'center'
  },
  roomInput: {
    width: '100%',
    height: 50,
    backgroundColor: '#EFEBE4',
    borderRadius: 25,
    paddingHorizontal: 20,
    fontSize: 16,
    color: '#4A2E18',
    marginBottom: 16
  },
  primaryButton: {
    width: '100%',
    height: 50,
    backgroundColor: '#C99E5C',
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center'
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EFEBE4'
  },
  roomBadge: {
    backgroundColor: '#EFEBE4',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14
  },
  roomBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4A2E18'
  },
  disconnectButton: {
    padding: 6
  },
  disconnectText: {
    fontSize: 14,
    color: '#7D6E65',
    fontWeight: '500'
  },
  minimalPlayerCard: {
    marginHorizontal: 16,
    marginTop: 10,
    backgroundColor: '#EFEBE4',
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  playerTopRow: {
    width: '100%',
    alignItems: 'flex-end',
    paddingRight: 4,
    marginBottom: -4,
  },
  playerSlider: {
    width: '100%',
    height: 25,
  },
  timeRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginTop: -8,
  },
  timeText: {
    fontSize: 10,
    color: '#7D6E65',
    fontWeight: '700',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '80%',
    alignSelf: 'center',
    marginTop: 6,
  },
  iconBtn: {
    padding: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimControl: {
    opacity: 0.35,
  },
  activeControl: {
    opacity: 1,
  },
  circlePlayBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#4A2E18',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.5,
  },
  heartSection: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    position: 'relative'
  },
  particleCanvas: {
    position: 'absolute',
    top: 20,
    alignItems: 'center',
    justifyContent: 'center'
  },
  floatingHeart: {
    position: 'absolute'
  },
  mainHeart: {
    fontSize: 65
  },
  statusLabel: {
    marginTop: 10,
    fontSize: 14,
    fontWeight: '500',
    color: '#7D6E65'
  },
  chatList: {
    flex: 1,
    paddingHorizontal: 16
  },
  chatContent: {
    paddingVertical: 8
  },
  messageRow: {
    marginVertical: 4,
    flexDirection: 'row'
  },
  userRow: {
    justifyContent: 'flex-end'
  },
  partnerRow: {
    justifyContent: 'flex-start'
  },
  messageBubble: {
    maxWidth: '75%',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 18
  },
  userBubble: {
    backgroundColor: '#C99E5C',
    borderBottomRightRadius: 4
  },
  partnerBubble: {
    backgroundColor: '#EFEBE4',
    borderBottomLeftRadius: 4
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20
  },
  userMessageText: {
    color: '#FFFFFF'
  },
  partnerMessageText: {
    color: '#4A2E18'
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#FAF9F6',
    borderTopWidth: 1,
    borderTopColor: '#EFEBE4',
    alignItems: 'center'
  },
  textInput: {
    flex: 1,
    height: 44,
    backgroundColor: '#EFEBE4',
    borderRadius: 22,
    paddingHorizontal: 18,
    fontSize: 15,
    color: '#4A2E18'
  },
  sendButton: {
    marginLeft: 10,
    paddingHorizontal: 16,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#C99E5C',
    justifyContent: 'center',
    alignItems: 'center'
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 14
  }
});
