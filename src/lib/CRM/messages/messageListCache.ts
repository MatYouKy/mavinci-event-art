import type { MessageFolder, MessageListItem } from '@/store/api/messagesApi';

const DATABASE_NAME = 'mavinci-crm-messages';
const STORE_NAME = 'mailbox-lists';
const DATABASE_VERSION = 1;
const MAX_CACHED_MESSAGES = 100;

interface MessageCacheRecord {
  key: string;
  userId: string;
  accountId: string;
  folder: MessageFolder;
  updatedAt: number;
  messages: MessageListItem[];
}

const getCacheKey = (userId: string, accountId: string, folder: MessageFolder) =>
  `${userId}:${accountId}:${folder}`;

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open message cache'));
  });

const sortNewestFirst = (messages: MessageListItem[]) =>
  [...messages].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

export async function readMessageListCache(
  userId: string,
  accountId: string,
  folder: MessageFolder,
): Promise<MessageListItem[]> {
  try {
    const database = await openDatabase();
    return await new Promise<MessageListItem[]>((resolve) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(getCacheKey(userId, accountId, folder));

      request.onsuccess = () => {
        const record = request.result as MessageCacheRecord | undefined;
        resolve(record ? sortNewestFirst(record.messages).slice(0, MAX_CACHED_MESSAGES) : []);
      };
      request.onerror = () => resolve([]);
      transaction.oncomplete = () => database.close();
      transaction.onabort = () => database.close();
    });
  } catch {
    return [];
  }
}

export async function writeMessageListCache(
  userId: string,
  accountId: string,
  folder: MessageFolder,
  messages: MessageListItem[],
): Promise<void> {
  try {
    const database = await openDatabase();
    const uniqueMessages = Array.from(
      new Map(
        sortNewestFirst(messages).map(
          (message) => [`${message.type}:${message.id}`, message] as const,
        ),
      ).values(),
    ).slice(0, MAX_CACHED_MESSAGES);

    await new Promise<void>((resolve) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const record: MessageCacheRecord = {
        key: getCacheKey(userId, accountId, folder),
        userId,
        accountId,
        folder,
        updatedAt: Date.now(),
        messages: uniqueMessages,
      };

      transaction.objectStore(STORE_NAME).put(record);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        resolve();
      };
      transaction.onabort = () => {
        database.close();
        resolve();
      };
    });
  } catch {
    // Cache is an optimization. A browser storage failure must not block the mailbox.
  }
}
