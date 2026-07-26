import React, { useState, useEffect, useRef } from 'react';
import { rtdb, auth } from './firebaseConfig';
import { ref, push, onValue, serverTimestamp as rtdbTimestamp, query, limitToLast } from 'firebase/database';

interface Message {
  id: string;
  text: string;
  userId: string;
  userName: string;
  userPhoto: string;
  timestamp: number;
}

const WatchPartyChat: React.FC<{ roomId: string }> = ({ roomId }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const user = auth.currentUser;

  useEffect(() => {
    const chatRef = query(ref(rtdb, `chats/${roomId}`), limitToLast(50));
    const unsubscribe = onValue(chatRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const msgList = Object.entries(data).map(([id, val]: [string, any]) => ({
          id,
          ...val,
        })).sort((a, b) => a.timestamp - b.timestamp);
        setMessages(msgList);
      }
    });

    return () => unsubscribe();
  }, [roomId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !user) return;

    const chatRef = ref(rtdb, `chats/${roomId}`);
    push(chatRef, {
      text: newMessage,
      userId: user.uid,
      userName: user.displayName || 'Fan de Seiko',
      userPhoto: user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName || 'User'}&background=random`,
      timestamp: rtdbTimestamp(),
    });
    setNewMessage('');
  };

  return (
    <div className="flex flex-col h-full bg-black/40 backdrop-blur-xl border-l border-white/10 w-80 animate-slide-in-right">
      <div className="p-4 border-b border-white/10 flex items-center justify-between">
        <h3 className="font-bebas text-xl text-red-500 tracking-widest">Chat en Vivo</h3>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Online</span>
        </div>
      </div>

      <div 
        ref={scrollRef}
        className="flex-grow overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-red-600/20"
      >
        {messages.map((msg) => (
          <div key={msg.id} className="flex gap-3 group">
            <img 
              src={msg.userPhoto} 
              alt={msg.userName} 
              className="w-8 h-8 rounded-full border border-white/10 flex-shrink-0"
              referrerPolicy="no-referrer"
            />
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] font-black text-red-500/80 uppercase tracking-tighter truncate">
                {msg.userName}
              </span>
              <p className="text-sm text-gray-200 break-words leading-relaxed">
                {msg.text}
              </p>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={sendMessage} className="p-4 bg-black/60 border-t border-white/10">
        <div className="relative">
          <input 
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Comenta algo..."
            className="w-full bg-white/5 border border-white/10 rounded-full py-2 px-4 pr-12 text-sm outline-none focus:border-red-600/50 transition-all placeholder:text-gray-600"
          />
          <button 
            type="submit"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-red-500 hover:text-red-400 transition-colors p-1"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
};

export default WatchPartyChat;
