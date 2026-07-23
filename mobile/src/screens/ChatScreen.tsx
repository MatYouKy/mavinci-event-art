import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Keyboard,
  Image,
  Alert,
  Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, spacing, typography } from '../theme';
import { supabase, supabaseUrl, supabaseAnonKey } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import EmployeeAvatar from '../components/EmployeeAvatar';
import { Conversation } from './ChatListScreen';
import { setActiveChatConversation } from '../services/chatNotifications';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type: string;
  attachment_url: string | null;
  attachment_filename?: string | null;
  attachment_size?: number | null;
  is_edited: boolean;
  created_at: string;
}

interface SenderInfo {
  id: string;
  name: string;
  surname: string;
  nickname?: string | null;
  avatar_url?: string | null;
  avatar_metadata?: any;
}

interface PendingAttachment {
  uri: string;
  name: string;
  size: number;
  mimeType: string;
}

interface Props {
  conversation: Conversation;
  onBack: () => void;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024;

function getMessageType(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  return 'file';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ChatScreen({ conversation, onBack }: Props) {
  const { employee } = useAuth();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<Message[]>([]);
  const [senders, setSenders] = useState<Map<string, SenderInfo>>(new Map());
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [showMenu, setShowMenu] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const otherParticipant = conversation.participants.find(
    (p) => p.employee_id !== employee?.id
  );

  const conversationTitle =
    conversation.title ||
    (otherParticipant?.employee
      ? otherParticipant.employee.nickname ||
        `${otherParticipant.employee.name} ${otherParticipant.employee.surname}`
      : 'Czat');

  const fetchMessages = useCallback(async () => {
    if (employee) {
      const storageKey = `chat_deleted_${employee.id}`;
      try {
        const stored = await AsyncStorage.getItem(storageKey);
        if (stored) {
          setDeletedIds(new Set(JSON.parse(stored)));
        }
      } catch {}
    }

    const { data, error } = await supabase
      .from('employee_messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: true })
      .limit(100);

    if (!error && data) {
      setMessages(data);

      const senderIds = [...new Set(data.map((m) => m.sender_id))];
      const { data: sendersData } = await supabase
        .from('employees')
        .select('id, name, surname, nickname, avatar_url, avatar_metadata')
        .in('id', senderIds);

      if (sendersData) {
        const map = new Map<string, SenderInfo>();
        sendersData.forEach((s) => map.set(s.id, s));
        setSenders(map);
      }
    }
  }, [conversation.id, employee]);

  const markAsRead = useCallback(async () => {
    if (!employee) return;
    await supabase
      .from('employee_conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversation.id)
      .eq('employee_id', employee.id);
  }, [employee, conversation.id]);

  useEffect(() => {
    setActiveChatConversation(conversation.id);

    const load = async () => {
      setIsLoading(true);
      await fetchMessages();
      await markAsRead();
      setIsLoading(false);
    };
    load();

    return () => {
      markAsRead();
      setActiveChatConversation(null);
    };
  }, [fetchMessages, markAsRead]);

  useEffect(() => {
    const channel = supabase
      .channel(`chat-${conversation.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'employee_messages',
          filter: `conversation_id=eq.${conversation.id}`,
        },
        async (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => [...prev, newMsg]);

          if (!senders.has(newMsg.sender_id)) {
            const { data } = await supabase
              .from('employees')
              .select('id, name, surname, nickname, avatar_url, avatar_metadata')
              .eq('id', newMsg.sender_id)
              .maybeSingle();
            if (data) {
              setSenders((prev) => new Map(prev).set(data.id, data));
            }
          }

          markAsRead();
          setTimeout(() => {
            flatListRef.current?.scrollToEnd({ animated: true });
          }, 100);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'employee_messages',
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          const updated = payload.new as Message;
          setMessages((prev) =>
            prev.map((m) => (m.id === updated.id ? updated : m))
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'employee_messages',
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          const deleted = payload.old as { id: string };
          setMessages((prev) => prev.filter((m) => m.id !== deleted.id));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation.id, markAsRead, senders]);

  const uploadAttachment = async (
    attachment: PendingAttachment
  ): Promise<{ url: string } | null> => {
    try {
      const mimeExtensionMap: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/heic': 'heic',
        'image/heif': 'heif',
        'video/mp4': 'mp4',
        'video/quicktime': 'mov',
        'application/pdf': 'pdf',
      };
  
      const originalExtension = attachment.name
        .split('.')
        .pop()
        ?.toLowerCase();
  
      const extension =
        originalExtension && originalExtension !== attachment.name.toLowerCase()
          ? originalExtension
          : mimeExtensionMap[attachment.mimeType] || 'bin';
  
      const storagePath = `${conversation.id}/${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}.${extension}`;
  
      console.log('[Chat] Reading attachment:', {
        uri: attachment.uri,
        name: attachment.name,
        mimeType: attachment.mimeType,
        declaredSize: attachment.size,
        storagePath,
      });
  
      const base64 = await FileSystem.readAsStringAsync(attachment.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
  
      if (!base64) {
        throw new Error('Odczytany plik jest pusty');
      }
  
      const arrayBuffer = decode(base64);
  
      if (arrayBuffer.byteLength === 0) {
        throw new Error('Plik po konwersji ma rozmiar 0 bajtów');
      }
  
      console.log('[Chat] Uploading attachment:', {
        storagePath,
        mimeType: attachment.mimeType,
        arrayBufferSize: arrayBuffer.byteLength,
      });
  
      const { error: uploadError } = await supabase.storage
        .from('chat-attachments')
        .upload(storagePath, arrayBuffer, {
          contentType: attachment.mimeType,
          cacheControl: '3600',
          upsert: false,
        });
  
      if (uploadError) {
        console.error('[Chat] Upload error:', uploadError);
        return null;
      }
  
      const { data: urlData } = supabase.storage
        .from('chat-attachments')
        .getPublicUrl(storagePath);
  
      if (!urlData.publicUrl) {
        throw new Error('Nie udało się wygenerować publicznego adresu pliku');
      }
  
      return {
        url: urlData.publicUrl,
      };
    } catch (error) {
      console.error('[Chat] Attachment processing error:', error);
      return null;
    }
  };

  const sendMessage = async () => {
    const text = inputText.trim();
    const attachment = pendingAttachment;

    if (!text && !attachment) return;
    if (!employee || isSending) return;

    setIsSending(true);
    setInputText('');
    setPendingAttachment(null);
    Keyboard.dismiss();

    let attachmentUrl: string | null = null;
    let messageType = 'text';

    if (attachment) {
      const result = await uploadAttachment(attachment);
      if (!result) {
        Alert.alert('Błąd', 'Nie udało się wysłać załącznika. Spróbuj ponownie.');
        setIsSending(false);
        setPendingAttachment(attachment);
        if (text) setInputText(text);
        return;
      }
      attachmentUrl = result.url;
      messageType = getMessageType(attachment.mimeType);
    }

    const insertPayload: Record<string, unknown> = {
      conversation_id: conversation.id,
      sender_id: employee.id,
      content: text || (attachment?.name ?? ''),
      message_type: messageType,
    };

    if (attachmentUrl && attachment) {
      insertPayload.attachment_url = attachmentUrl;
      insertPayload.attachment_filename = attachment.name;
      insertPayload.attachment_size = attachment.size;
    }

    const { data: insertedMsg, error } = await supabase
      .from('employee_messages')
      .insert(insertPayload)
      .select('id')
      .single();

    if (error) {
      if (text) setInputText(text);
      if (attachment) setPendingAttachment(attachment);
      console.error('Failed to send:', error.message);
    } else if (insertedMsg) {
      triggerChatPush(
        conversation.id,
        employee.id,
        text || attachment?.name || '',
        insertedMsg.id,
        messageType
      );
    }

    setIsSending(false);
  };

  const triggerChatPush = async (
    convId: string,
    senderId: string,
    content: string,
    messageId: string,
    messageType: string
  ) => {
    try {
      await fetch(`${supabaseUrl}/functions/v1/send-chat-push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          type: 'INSERT',
          table: 'employee_messages',
          schema: 'public',
          record: {
            id: messageId,
            conversation_id: convId,
            sender_id: senderId,
            content,
            message_type: messageType,
            created_at: new Date().toISOString(),
          },
          old_record: null,
        }),
      });
    } catch (err) {
      console.warn('Push notification trigger failed:', err);
    }
  };

  const toggleSelectMessage = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  };

  const deleteSelectedForMe = async () => {
    if (selectedIds.size === 0 || !employee) return;

    Alert.alert(
      'Usuń wiadomości',
      `Usunąć ${selectedIds.size} wiadomości? Zostaną ukryte tylko u Ciebie.`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Usuń',
          style: 'destructive',
          onPress: async () => {
            const storageKey = `chat_deleted_${employee.id}`;
            setDeletedIds((prev) => {
              const next = new Set(prev);
              selectedIds.forEach((id) => next.add(id));
              AsyncStorage.setItem(storageKey, JSON.stringify(Array.from(next))).catch(() => {});
              return next;
            });
            exitSelectMode();
          },
        },
      ]
    );
  };

  const handleLongPress = (id: string) => {
    if (!isSelectMode) {
      setIsSelectMode(true);
      setSelectedIds(new Set([id]));
    }
  };

  const showAttachmentOptions = () => {
    Alert.alert('Dodaj załącznik', 'Wybierz źródło', [
      {
        text: 'Zdjęcie lub wideo',
        onPress: pickImage,
      },
      {
        text: 'Dokument',
        onPress: pickDocument,
      },
      { text: 'Anuluj', style: 'cancel' },
    ]);
  };

  const pickImage = async () => {
    const permission =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
  
    if (!permission.granted) {
      Alert.alert(
        'Brak uprawnień',
        'Zezwól na dostęp do galerii w ustawieniach.'
      );
      return;
    }
  
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.8,
      videoMaxDuration: 60,
    });
  
    if (result.canceled || !result.assets?.[0]) return;
  
    const asset = result.assets[0];
    const fileSize = asset.fileSize || 0;
    const isVideo = asset.type === 'video';
  
    if (fileSize > MAX_FILE_SIZE) {
      Alert.alert(
        'Za duży plik',
        `Maksymalny rozmiar to ${formatFileSize(MAX_FILE_SIZE)}`
      );
      return;
    }
  
    const mimeType =
      asset.mimeType ||
      (isVideo ? 'video/mp4' : 'image/jpeg');
  
    const extensionMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/heic': 'heic',
      'image/heif': 'heif',
      'video/mp4': 'mp4',
      'video/quicktime': 'mov',
    };
  
    const fallbackExtension =
      extensionMap[mimeType] || (isVideo ? 'mp4' : 'jpg');
  
    const originalName = asset.fileName?.trim();
  
    const fileName =
      originalName && originalName.includes('.')
        ? originalName
        : `${isVideo ? 'video' : 'image'}_${Date.now()}.${fallbackExtension}`;
  
    setPendingAttachment({
      uri: asset.uri,
      name: fileName,
      size: fileSize,
      mimeType,
    });
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const doc = result.assets[0];

    if (doc.size && doc.size > MAX_FILE_SIZE) {
      Alert.alert('Za duży plik', `Maksymalny rozmiar to ${formatFileSize(MAX_FILE_SIZE)}`);
      return;
    }

    setPendingAttachment({
      uri: doc.uri,
      name: doc.name,
      size: doc.size || 0,
      mimeType: doc.mimeType || 'application/octet-stream',
    });
  };

  const formatMessageTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDateSeparator = (dateStr: string): string => {
    const date = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return 'Dzisiaj';
    if (date.toDateString() === yesterday.toDateString()) return 'Wczoraj';
    return date.toLocaleDateString('pl-PL', {
      day: 'numeric',
      month: 'long',
      year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
    });
  };

  const renderAttachment = (item: Message, isMine: boolean) => {
    if (!item.attachment_url) return null;

    if (item.message_type === 'image') {
      return (
        <TouchableOpacity
          onPress={() => Linking.openURL(item.attachment_url!)}
          activeOpacity={0.8}
        >
          <Image
            source={{ uri: item.attachment_url }}
            style={styles.attachmentImage}
            resizeMode="cover"
          />
        </TouchableOpacity>
      );
    }

    if (item.message_type === 'video') {
      return (
        <TouchableOpacity
          onPress={() => Linking.openURL(item.attachment_url!)}
          style={styles.videoPlaceholder}
          activeOpacity={0.7}
        >
          <Feather name="play-circle" size={32} color="#fff" />
          <Text style={styles.videoLabel}>Odtwórz wideo</Text>
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity
        onPress={() => Linking.openURL(item.attachment_url!)}
        style={[styles.fileAttachment, isMine ? styles.fileAttachmentMine : styles.fileAttachmentTheirs]}
        activeOpacity={0.7}
      >
        <Feather name="file-text" size={18} color={isMine ? '#0f1119' : colors.primary.gold} />
        <View style={styles.fileInfo}>
          <Text style={[styles.fileName, isMine && styles.fileNameMine]} numberOfLines={1}>
            {item.attachment_filename || 'Plik'}
          </Text>
          {item.attachment_size ? (
            <Text style={[styles.fileSize, isMine && styles.fileSizeMine]}>
              {formatFileSize(item.attachment_size)}
            </Text>
          ) : null}
        </View>
        <Feather name="download" size={14} color={isMine ? '#0f1119' : colors.text.tertiary} />
      </TouchableOpacity>
    );
  };

  const visibleMessages = messages.filter((m) => !deletedIds.has(m.id));

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    const isMine = item.sender_id === employee?.id;
    const sender = senders.get(item.sender_id);
    const showAvatar = !isMine && (index === visibleMessages.length - 1 || item.sender_id !== visibleMessages[index + 1]?.sender_id);
    const showDateSep = index === 0 || new Date(item.created_at).toDateString() !== new Date(visibleMessages[index - 1].created_at).toDateString();
    const consecutive = index > 0 && visibleMessages[index - 1].sender_id === item.sender_id && new Date(item.created_at).getTime() - new Date(visibleMessages[index - 1].created_at).getTime() < 60000;
    const hasAttachment = !!item.attachment_url;
    const hasTextContent = item.message_type === 'text' && !!item.content;
    const hasCaption = item.message_type !== 'text' && !!item.content && item.content !== (item.attachment_filename || '');
    const isSelected = selectedIds.has(item.id);

    return (
      <View>
        {showDateSep && (
          <View style={styles.dateSeparator}>
            <View style={styles.dateLine} />
            <Text style={styles.dateText}>{formatDateSeparator(item.created_at)}</Text>
            <View style={styles.dateLine} />
          </View>
        )}

        <TouchableOpacity
          activeOpacity={isSelectMode ? 0.6 : 0.9}
          onLongPress={() => handleLongPress(item.id)}
          onPress={isSelectMode ? () => toggleSelectMessage(item.id) : undefined}
          style={[
            styles.messageRow,
            isMine && styles.messageRowMine,
            consecutive && styles.messageConsecutive,
          ]}
        >
          {isSelectMode && (
            <View style={styles.selectCircle}>
              <Feather
                name={isSelected ? 'check-circle' : 'circle'}
                size={20}
                color={isSelected ? colors.primary.gold : colors.text.tertiary}
              />
            </View>
          )}

          {!isMine && !isSelectMode && (
            <View style={styles.avatarSlot}>
              {showAvatar && sender ? (
                <EmployeeAvatar
                  avatarUrl={sender.avatar_url}
                  avatarMetadata={sender.avatar_metadata}
                  employeeName={sender.nickname || sender.name}
                  size={28}
                />
              ) : (
                <View style={{ width: 28 }} />
              )}
            </View>
          )}

          <View style={styles.bubbleWrapper}>
            {conversation.is_group && !isMine && !consecutive && sender && (
              <Text style={styles.senderName}>
                {sender.nickname || sender.name}
              </Text>
            )}
            <View style={[
              styles.bubble,
              isMine ? styles.bubbleMine : styles.bubbleTheirs,
              hasAttachment && styles.bubbleWithAttachment,
            ]}>
              {hasAttachment && renderAttachment(item, isMine)}
              {hasCaption && (
                <Text style={[styles.messageText, isMine && styles.messageTextMine, { marginTop: 6 }]}>
                  {item.content}
                </Text>
              )}
              {hasTextContent && (
                <Text style={[styles.messageText, isMine && styles.messageTextMine]}>
                  {item.content}
                </Text>
              )}
            </View>
            {showAvatar && (
              <Text style={[styles.messageTime, isMine && styles.messageTimeMine]}>
                {formatMessageTime(item.created_at)}
                {item.is_edited && ' (edytowane)'}
              </Text>
            )}
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Feather name="chevron-left" size={26} color={colors.text.primary} />
        </TouchableOpacity>

        <View style={styles.headerInfo}>
          {!conversation.is_group && otherParticipant?.employee ? (
            <EmployeeAvatar
              avatarUrl={otherParticipant.employee.avatar_url}
              avatarMetadata={otherParticipant.employee.avatar_metadata}
              employeeName={otherParticipant.employee.nickname || otherParticipant.employee.name}
              size={36}
            />
          ) : (
            <View style={styles.headerGroupIcon}>
              <Feather name="users" size={16} color={colors.primary.gold} />
            </View>
          )}
          <View style={styles.headerTextWrap}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {conversationTitle}
            </Text>
            {!conversation.is_group && (
              <Text style={styles.headerSubtitle}>
                {isTyping ? 'pisze...' : 'aktywny(a)'}
              </Text>
            )}
          </View>
        </View>

        <TouchableOpacity style={styles.headerAction} onPress={() => setShowMenu(!showMenu)}>
          <Feather name="more-vertical" size={20} color={colors.text.secondary} />
        </TouchableOpacity>
      </View>

      {showMenu && (
        <View style={styles.menuOverlay}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => { setIsSelectMode(true); setShowMenu(false); }}
          >
            <Feather name="check-circle" size={16} color={colors.primary.gold} />
            <Text style={styles.menuItemText}>Zaznacz wiadomo\u015bci</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Messages */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary.gold} />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={visibleMessages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messagesList}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => {
            flatListRef.current?.scrollToEnd({ animated: false });
          }}
          ListEmptyComponent={
            <View style={styles.emptyMessages}>
              <Feather name="message-circle" size={40} color={colors.text.tertiary} />
              <Text style={styles.emptyMessagesText}>
                Rozpocznij rozmowę!
              </Text>
            </View>
          }
        />
      )}

      {/* Selection mode action bar */}
      {isSelectMode && (
        <View style={styles.selectBar}>
          <TouchableOpacity onPress={exitSelectMode} style={styles.selectBarCancel}>
            <Text style={styles.selectBarCancelText}>Anuluj</Text>
          </TouchableOpacity>
          <Text style={styles.selectBarCount}>
            {selectedIds.size > 0 ? `Zaznaczono: ${selectedIds.size}` : 'Zaznacz wiadomości'}
          </Text>
          <TouchableOpacity
            onPress={deleteSelectedForMe}
            style={[styles.selectBarDelete, selectedIds.size === 0 && { opacity: 0.3 }]}
            disabled={selectedIds.size === 0}
          >
            <Feather name="trash-2" size={16} color="#ef4444" />
            <Text style={styles.selectBarDeleteText}>Usuń</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Pending attachment preview */}
      {pendingAttachment && (
        <View style={styles.pendingBar}>
          {pendingAttachment.mimeType.startsWith('image/') ? (
            <Image source={{ uri: pendingAttachment.uri }} style={styles.pendingThumb} />
          ) : (
            <View style={styles.pendingIconBox}>
              <Feather
                name={pendingAttachment.mimeType.startsWith('video/') ? 'video' : 'file-text'}
                size={16}
                color={colors.primary.gold}
              />
            </View>
          )}
          <View style={styles.pendingInfo}>
            <Text style={styles.pendingName} numberOfLines={1}>{pendingAttachment.name}</Text>
            <Text style={styles.pendingSize}>{formatFileSize(pendingAttachment.size)}</Text>
          </View>
          <TouchableOpacity onPress={() => setPendingAttachment(null)} style={styles.pendingRemove}>
            <Feather name="x" size={16} color={colors.text.tertiary} />
          </TouchableOpacity>
        </View>
      )}

      {/* Input */}
      <View style={[styles.inputContainer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.textInput}
            placeholder={pendingAttachment ? 'Komentarz (opcjonalnie)...' : 'Aa'}
            placeholderTextColor={colors.text.tertiary}
            value={inputText}
            onChangeText={setInputText}
            onFocus={() => markAsRead()}
            multiline
            maxLength={2000}
          />
          {inputText.trim().length > 0 || pendingAttachment ? (
            <TouchableOpacity
              style={styles.sendButton}
              onPress={sendMessage}
              disabled={isSending}
            >
              {isSending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Feather name="send" size={18} color="#fff" />
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.attachButton} onPress={showAttachmentOptions}>
              <Feather name="plus-circle" size={24} color={colors.primary.gold} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
    backgroundColor: colors.background.secondary,
  },
  backButton: {
    padding: spacing.xs,
  },
  headerInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: spacing.xs,
    gap: spacing.sm,
  },
  headerGroupIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary.gold + '20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTextWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: typography.fontSizes.md,
    fontWeight: typography.fontWeights.bold as any,
    color: colors.text.primary,
  },
  headerSubtitle: {
    fontSize: typography.fontSizes.xs,
    color: colors.status.success,
  },
  headerAction: {
    padding: spacing.sm,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messagesList: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  dateSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  dateLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border.default,
  },
  dateText: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
    paddingHorizontal: spacing.sm,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 2,
    paddingRight: 60,
  },
  messageRowMine: {
    flexDirection: 'row-reverse',
    paddingRight: 0,
    paddingLeft: 60,
  },
  messageConsecutive: {
    marginBottom: 1,
  },
  avatarSlot: {
    width: 32,
    marginRight: 6,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  bubbleWrapper: {
    maxWidth: '80%',
  },
  senderName: {
    fontSize: 11,
    color: colors.text.tertiary,
    marginBottom: 2,
    marginLeft: 12,
    fontWeight: typography.fontWeights.medium as any,
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  bubbleMine: {
    backgroundColor: colors.primary.gold,
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: colors.background.tertiary,
    borderBottomLeftRadius: 4,
  },
  bubbleWithAttachment: {
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  messageText: {
    fontSize: typography.fontSizes.md,
    color: colors.text.primary,
    lineHeight: 20,
  },
  messageTextMine: {
    color: '#fff',
  },
  messageTime: {
    fontSize: 10,
    color: colors.text.tertiary,
    marginTop: 3,
    marginLeft: 12,
  },
  messageTimeMine: {
    textAlign: 'right',
    marginLeft: 0,
    marginRight: 12,
  },
  emptyMessages: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 40,
  },
  emptyMessagesText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.tertiary,
    marginTop: spacing.sm,
  },
  // Attachment styles
  attachmentImage: {
    width: 200,
    height: 150,
    borderRadius: 12,
  },
  videoPlaceholder: {
    width: 200,
    height: 120,
    borderRadius: 12,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoLabel: {
    color: '#fff',
    fontSize: 11,
    marginTop: 4,
    opacity: 0.8,
  },
  fileAttachment: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 8,
  },
  fileAttachmentMine: {
    backgroundColor: 'rgba(15,17,25,0.1)',
  },
  fileAttachmentTheirs: {
    backgroundColor: 'rgba(211,187,115,0.08)',
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: 12,
    fontWeight: '500' as any,
    color: colors.text.primary,
  },
  fileNameMine: {
    color: '#0f1119',
  },
  fileSize: {
    fontSize: 10,
    color: colors.text.tertiary,
    marginTop: 1,
  },
  fileSizeMine: {
    color: 'rgba(15,17,25,0.5)',
  },
  // Pending attachment bar
  pendingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.default,
    backgroundColor: colors.background.secondary,
    gap: 8,
  },
  pendingThumb: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
  pendingIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.primary.gold + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pendingInfo: {
    flex: 1,
  },
  pendingName: {
    fontSize: 12,
    color: colors.text.primary,
  },
  pendingSize: {
    fontSize: 10,
    color: colors.text.tertiary,
  },
  pendingRemove: {
    padding: 6,
  },
  // Input
  inputContainer: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.default,
    backgroundColor: colors.background.secondary,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.background.tertiary,
    borderRadius: 22,
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 4,
    minHeight: 42,
  },
  textInput: {
    flex: 1,
    fontSize: typography.fontSizes.md,
    color: colors.text.primary,
    maxHeight: 100,
    paddingVertical: 8,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary.gold,
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachButton: {
    padding: 5,
  },
  // Selection mode styles
  selectCircle: {
    marginRight: 8,
    justifyContent: 'center' as const,
  },
  selectBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border.default,
    backgroundColor: colors.background.secondary,
  },
  selectBarCancel: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  selectBarCancelText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.secondary,
  },
  selectBarCount: {
    fontSize: typography.fontSizes.xs,
    color: colors.text.tertiary,
  },
  selectBarDelete: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  selectBarDeleteText: {
    fontSize: typography.fontSizes.sm,
    color: '#ef4444',
    fontWeight: '500' as any,
  },
  // Menu overlay
  menuOverlay: {
    position: 'absolute' as const,
    top: 56,
    right: spacing.sm,
    backgroundColor: colors.background.secondary,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border.default,
    paddingVertical: 4,
    minWidth: 180,
    zIndex: 100,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  menuItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  menuItemText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.primary,
  },
});
