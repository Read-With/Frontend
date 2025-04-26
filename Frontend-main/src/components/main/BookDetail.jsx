// ✅ components/BookDetail.jsx
import React from 'react';

const BookDetail = ({ book, onBack }) => {
  return (
    <div style={{ padding: '2rem' }}>
      <button onClick={onBack} style={{
        background: '#282c34',
        color: 'white',
        border: 'none',
        padding: '0.5rem 1rem',
        borderRadius: '5px',
        marginBottom: '1rem',
        cursor: 'pointer'
      }}>
        ← 뒤로가기
      </button>

      <div style={{ display: 'flex', gap: '2rem' }}>
        <img
          src={book.image || 'https://via.placeholder.com/120x160?text=No+Image'}
          alt={book.title}
          style={{ width: '200px', height: '300px', objectFit: 'cover' }}
        />
        <div>
          <h2>{book.title}</h2>
          <p><strong>저자:</strong> {book.author}</p>
          <p><strong>출판일:</strong> {book.pubdate}</p>
          <p><strong>출판사:</strong> {book.publisher}</p>
          <p dangerouslySetInnerHTML={{ __html: book.description }}></p>
        </div>
      </div>
    </div>
  );
};

export default BookDetail;
