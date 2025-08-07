import React, { useState, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import Header from '../common/Header';
import './ChatbotPage.css';

// 임의의 챗봇 응답 생성 함수
const generateChatbotResponse = (message, bookTitle, characterName = null) => {
  // 캐릭터 모드인 경우
  if (characterName) {
    // 캐릭터 응답을 위한 키워드
    const characterKeywords = {
      '안녕': [
        `안녕하세요! 저는 ${bookTitle}의 ${characterName}입니다. 무엇이 궁금하신가요?`,
        `반갑습니다! ${characterName}입니다. 제 이야기가 궁금하신가요?`
      ],
      '누구': [
        `저는 ${bookTitle}에 등장하는 ${characterName}입니다. 작품 속에서 중요한 역할을 맡고 있죠.`,
        `${characterName}입니다. ${bookTitle}에서 제 이야기를 찾아볼 수 있어요.`
      ],
      '생각': [
        `${characterName}으로서 저는 그 상황에 대해 복잡한 감정을 느꼈습니다.`,
        `그 문제에 대한 제 생각은 작품 속에서 점차 변화해갔어요.`
      ],
      '왜': [
        `제가 그런 선택을 한 이유는 당시 상황에서 최선이라고 생각했기 때문입니다.`,
        `그건 제 성격과 신념 때문이었죠. 작품을 읽으시면 더 자세히 이해하실 수 있을 거예요.`
      ],
      '어떻게': [
        `그 상황에서 저는 제 직관을 믿고 행동했습니다.`,
        `여러 고민 끝에 그런 결정을 내렸어요. 쉽지 않은 선택이었죠.`
      ],
      '관계': [
        `다른 인물들과의 관계는 제 이야기에서 중요한 부분을 차지합니다.`,
        `그 인물과 저는 작품 속에서 특별한 관계를 맺고 있어요.`
      ]
    };

    // 캐릭터 기본 응답
    const characterDefaultResponses = [
      `흥미로운 질문이네요. ${bookTitle}에서 제 역할에 대해 더 알고 싶으신가요?`,
      `그 부분은 제 이야기에서 중요한 전환점이었어요.`,
      `좋은 관점입니다. 그 상황에서 저는 많은 것을 배웠죠.`,
      `그것은 제가 작품 속에서 겪는 여러 도전 중 하나였어요.`,
      `그 질문에 대해서는 작품 속에서 답을 찾으실 수 있을 거예요.`
    ];

    // 메시지에서 키워드 찾기
    let response = null;
    Object.keys(characterKeywords).forEach(keyword => {
      if (message.toLowerCase().includes(keyword)) {
        const possibleResponses = characterKeywords[keyword];
        response = possibleResponses[Math.floor(Math.random() * possibleResponses.length)];
      }
    });

    // 키워드가 없으면 기본 응답 중 하나 선택
    if (!response) {
      response = characterDefaultResponses[Math.floor(Math.random() * characterDefaultResponses.length)];
    }

    // 응답 지연 시간 (ms)
    const delay = 500 + Math.random() * 1500;
    
    return new Promise(resolve => {
      setTimeout(() => {
        resolve(response);
      }, delay);
    });
  } 
  // 일반 책 챗봇 모드
  else {
    // 간단한 키워드 기반 응답
    const bookKeywords = {
      '안녕': [
        `안녕하세요! ${bookTitle}에 대해 어떤 것이든 물어보세요.`,
        `반갑습니다! ${bookTitle}에 관한 질문이 있으신가요?`
      ],
      '작가': [
        `${bookTitle}의 작가는 문학적 배경과 사회적 상황을 깊이 이해하고 있었습니다.`,
        `작가는 이 작품을 통해 당시의 사회 문제를 비판적으로 다루고 있습니다.`
      ],
      '주인공': [
        `주인공은 복잡한 내면 세계를 가진 인물로, 작품 전반에 걸쳐 성장하는 모습을 보여줍니다.`,
        `주인공의 내적 갈등은 이 작품의 핵심 주제 중 하나입니다.`
      ],
      '의미': [
        `이 작품은 인간의 실존적 고민과 사회적 모순을 다루고 있습니다.`,
        `작품의 상징적 의미는 다양한 관점에서 해석될 수 있습니다.`
      ],
      '결말': [
        `결말은 열린 해석의 여지를 남기고 있어 독자의 생각에 따라 다양하게 이해될 수 있습니다.`,
        `작품의 결말은 주인공의 성장과 깨달음을 상징적으로 보여주고 있습니다.`
      ],
      '배경': [
        `이 작품의 시대적 배경은 당시의 사회적, 정치적 상황을 반영하고 있습니다.`,
        `작품의 공간적 배경은 인물들의 심리 상태를 상징적으로 표현하는 역할을 합니다.`
      ]
    };

    // 기본 응답
    const bookDefaultResponses = [
      `흥미로운 질문이네요. ${bookTitle}에서는 그 부분이 중요한 의미를 가집니다.`,
      `${bookTitle}의 그 부분은 작품의 주제와 깊은 연관이 있습니다.`,
      `좋은 관점입니다. ${bookTitle}에서 그 요소는 작가의 의도를 잘 보여줍니다.`,
      `${bookTitle}의 그 측면은 다양한 해석이 가능한 부분입니다.`,
      `그 질문에 대해서는 작품 내에서 여러 단서를 찾아볼 수 있습니다.`
    ];

    // 메시지에서 키워드 찾기
    let response = null;
    Object.keys(bookKeywords).forEach(keyword => {
      if (message.toLowerCase().includes(keyword)) {
        const possibleResponses = bookKeywords[keyword];
        response = possibleResponses[Math.floor(Math.random() * possibleResponses.length)];
      }
    });

    // 키워드가 없으면 기본 응답 중 하나 선택
    if (!response) {
      response = bookDefaultResponses[Math.floor(Math.random() * bookDefaultResponses.length)];
    }

    // 응답 지연 시간 (ms)
    const delay = 500 + Math.random() * 1500;
    
    return new Promise(resolve => {
      setTimeout(() => {
        resolve(response);
      }, delay);
    });
  }
};

const ChatbotPage = () => {
  const { filename, characterName } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  
  // location.state에서 book 정보를 가져오거나, 없으면 filename에서 생성
  const book = location.state?.book || {
    title: filename.replace('.epub', '').replace(/([A-Z])/g, ' $1').trim(),
    author: '알 수 없음',
    filename: `/books/${filename}`
  };

  // 캐릭터 모드인지 확인
  const isCharacterMode = !!characterName;

  // 초기 환영 메시지
  useEffect(() => {
    const welcomeMessage = {
      id: Date.now(),
      text: isCharacterMode 
        ? `안녕하세요! 저는 ${book.title}에 등장하는 ${characterName}입니다. 저에 대해 어떤 것이든 물어보세요.`
        : `안녕하세요! ${book.title}에 대해 어떤 것이든 물어보세요. 등장인물, 주제, 상징, 해석 등에 대해 답변해 드릴게요.`,
      sender: 'bot',
      timestamp: new Date().toISOString()
    };
    
    setMessages([welcomeMessage]);
  }, [book.title, characterName, isCharacterMode]);

  // 메시지 스크롤 자동 이동
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleInputChange = (e) => {
    setInputMessage(e.target.value);
    
    // 입력에 따라 textarea 높이 자동 조절
    if (textareaRef.current) {
      // 현재 입력된 텍스트에 줄바꿈이 있는지 확인
      const hasLineBreak = e.target.value.includes('\n');
      // 텍스트 길이가 충분히 길어서 자동 줄바꿈이 필요한지 확인 (대략적인 문자 수)
      const isLongText = e.target.value.length > 50;
      
      if (hasLineBreak || isLongText) {
        // 줄바꿈이 있거나 텍스트가 길면 높이 자동 조절
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.overflowY = 'auto';
        const newHeight = Math.min(textareaRef.current.scrollHeight, 80); // 최대 높이 80px
        textareaRef.current.style.height = `${newHeight}px`;
      } else {
        // 한 줄 텍스트는 기본 높이 유지
        textareaRef.current.style.height = '20px';
        textareaRef.current.style.overflowY = 'hidden';
      }
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    
    if (!inputMessage.trim()) return;
    
    // 사용자 메시지 추가
    const userMessage = {
      id: Date.now(),
      text: inputMessage,
      sender: 'user',
      timestamp: new Date().toISOString()
    };
    
    setMessages(prevMessages => [...prevMessages, userMessage]);
    setInputMessage('');
    setIsTyping(true);
    
    // 챗봇 응답 생성
    try {
      const response = await generateChatbotResponse(inputMessage, book.title, characterName);
      
      const botMessage = {
        id: Date.now() + 1,
        text: response,
        sender: 'bot',
        timestamp: new Date().toISOString()
      };
      
      setMessages(prevMessages => [...prevMessages, botMessage]);
    } catch (error) {
      const errorMessage = {
        id: Date.now() + 1,
        text: '죄송합니다. 응답을 생성하는 중에 오류가 발생했습니다.',
        sender: 'bot',
        timestamp: new Date().toISOString()
      };
      
      setMessages(prevMessages => [...prevMessages, errorMessage]);
    } finally {
      setIsTyping(false);
    }
  };
  
  const handleBackButton = () => {
    if (isCharacterMode) {
      navigate(`/user/graph/${filename}`, { state: { book } });
    } else {
      navigate('/');
    }
  };
  
  const handleViewerClick = () => {
    navigate(`/user/viewer/${filename}`, { state: { book } });
  };
  
  return (
    <div className="chatbot-page">
      <Header userNickname="User Nickname" />
      
      <div className="chatbot-container">
        <div className="chatbot-header">
          <button className="back-button" onClick={handleBackButton}>
            {isCharacterMode ? '← 관계도' : '← 라이브러리'}
          </button>
          <div className="book-info">
            {isCharacterMode ? (
              <h1>
                {characterName} <span className="character-book-title">- {book.title}</span>
              </h1>
            ) : (
              <h1>{book.title}</h1>
            )}
            {!isCharacterMode && <p>저자: {book.author}</p>}
          </div>
          <div className="chatbot-actions">
            <button className="action-button viewer-button" onClick={handleViewerClick}>
              📖 읽기
            </button>
          </div>
        </div>
        
        <div className="chatbot-content">
          <div className="chat-messages">
            {messages.map(message => (
              <div 
                key={message.id} 
                className={`message-wrapper ${message.sender === 'user' ? 'message-wrapper-user' : 'message-wrapper-bot'}`}
              >
                <div className={`message ${message.sender === 'user' ? 'user-message' : 'bot-message'}`}>
                  <div className="message-bubble">
                    {message.text}
                  </div>
                </div>
                <div className={`message-time-outside ${message.sender === 'user' ? 'message-time-right' : 'message-time-left'}`}>
                  {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="message-wrapper message-wrapper-bot">
                <div className="message bot-message typing">
                  <div className="message-bubble">
                    <div className="typing-indicator">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          
          <form className="chat-input" onSubmit={handleSendMessage}>
            <textarea
              ref={textareaRef}
              value={inputMessage}
              onChange={handleInputChange}
              placeholder={isCharacterMode ? `${characterName}에게 질문하세요...` : `${book.title}에 대해 질문하세요...`}
              disabled={isTyping}
              rows="1"
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (inputMessage.trim()) {
                    handleSendMessage(e);
                  }
                }
              }}
            />
            <button type="submit" disabled={!inputMessage.trim() || isTyping}>
              전송
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ChatbotPage; 