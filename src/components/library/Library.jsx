import React from 'react';
import { useNavigate} from 'react-router-dom';
import PageLayout from '../common/PageLayout';
import { useEffect, useState } from 'react';

const Library = ({ darkMode }) => {
  const [books, setBooks] = useState([]);
  const navigate = useNavigate();
  const handleSelect = (book) => {
    navigate(`/viewer/${encodeURIComponent(book.filename)}`, { state: { book } });
  };
  useEffect(() => {
    fetch('/books.json')
      .then(res => res.json())
      .then(setBooks);
  }, []);



  return (
    <PageLayout darkMode={darkMode}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>
        📚 나의 서재
      </h1>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: '1rem',
        }}
      >
        {books.map((book, idx) => (
          <div
            key={idx}
            onClick={() => handleSelect(book)}
            style={{
              cursor: 'pointer',
              border: '1px solid #ddd',
              borderRadius: '8px',
              padding: '0.5rem',
              backgroundColor: darkMode ? '#1f2937' : '#f9f9f9',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            }}
          >
            <img
              src={book.cover}
              alt={book.title}
              style={{
                width: '100%',
                height: '180px',
                objectFit: 'cover',
                borderRadius: '4px',
              }}
            />
            <div
              style={{
                marginTop: '0.5rem',
                fontWeight: 'bold',
                fontSize: '1rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {book.title}
            </div>
          </div>
        ))}
      </div>
    </PageLayout>
  );
};

export default Library;
