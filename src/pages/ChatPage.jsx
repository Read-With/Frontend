import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import './ChatPage.css';
import charactersData from '../data/characters.json';

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

const RECOMMEND_MESSAGES = [
  "너는 어떤 인물이야?",
  "주인공과 무슨 관계야?",
  "이야기에서 어떤 역할을 맡고 있어?",
  "가장 기억에 남는 순간이 뭐야?",
  "앞으로의 계획이 뭐야?"
];

function ChatPage() {
  const { filename, label } = useParams();
  const navigate = useNavigate();
  const [character, setCharacter] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [spoiler, setSpoiler] = useState('none');
  const [showRecommend, setShowRecommend] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    // characters.json에서 캐릭터 데이터 로드
    const characterData = charactersData.characters.find(
      char => char.common_name === label
    );
    
    if (characterData) {
      setCharacter({
        label: characterData.common_name,
        description: characterData.description,
        names: characterData.names
      });
    } else {
      // 캐릭터를 찾지 못한 경우
      setCharacter({
        label: label,
        description: '캐릭터 정보를 찾을 수 없습니다.'
      });
    }
  }, [label]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSendMessage = (e, customText) => {
    if (e) e.preventDefault();
    const text = customText !== undefined ? customText : inputMessage;
    if (!text.trim()) return;
    const now = new Date();
    const newMessage = {
      id: Date.now(),
      text,
      sender: 'user',
      timestamp: now.toISOString()
    };
    setMessages(prev => [...prev, newMessage]);
    setInputMessage('');
    setShowRecommend(false);
    setTimeout(() => {
      const aiMessage = {
        id: Date.now() + 1,
        text: '안녕하세요! 저는 ' + label + '입니다. 무엇을 도와드릴까요?',
        sender: 'ai',
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, aiMessage]);
    }, 1000);
  };

  // 현재 시간 구하기 (분까지만)
  const formatMsgTime = (timestamp) => {
    return formatTime(timestamp);
  };

  return (
    <div className="chat-outer-bg">
      <div className="chat-center-wrap">
        <div className="chat-header-bar">
          <button className="chat-back-btn" onClick={() => navigate(-1)}>
            &#8592;
          </button>
          <span className="chat-title">{character?.label || '채팅'}</span>
          <select
            className="chat-spoiler-select"
            value={spoiler}
            onChange={e => setSpoiler(e.target.value)}
          >
            <option value="none">스포일러 없음</option>
            <option value="mild">약간의 스포일러</option>
            <option value="full">스포일러 포함</option>
          </select>
        </div>
        <div className="chat-main-area">
          <div className="chat-messages">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`message-wrapper ${message.sender === 'user' ? 'user' : 'ai'}`}
              >
                <div className={`message ${message.sender === 'user' ? 'user-message' : 'ai-message'}`}>
                  <div className="message-content">
                    {message.text}
                  </div>
                </div>
                <div className={`message-timestamp-outside ${message.sender === 'user' ? 'right' : 'left'}`}>
                  {formatMsgTime(message.timestamp)}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          {showRecommend && (
            <div className="recommend-messages">
              {RECOMMEND_MESSAGES.map((msg, idx) => (
                <div className="recommend-message" key={idx} onClick={() => handleSendMessage(null, msg)}>
                  {msg}
                </div>
              ))}
            </div>
          )}
        </div>
        <form className="chat-input-bar" onSubmit={handleSendMessage}>
          <button
            type="button"
            className={`chat-plus-btn${showRecommend ? ' rotated' : ''}`}
            onClick={() => setShowRecommend(v => !v)}
            aria-label="추천메시지"
          >+
          </button>
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="메시지를 입력하세요..."
            className="chat-input"
          />
          <button type="submit" className="chat-send-btn" disabled={!inputMessage.trim()}>
            전송
          </button>
        </form>
      </div>
    </div>
  );
}

export default ChatPage; 