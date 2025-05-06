import React from 'react';

const SortDropdown = ({ value, onChange }) => {
  return (
    <div
      style={{
        marginTop: '1rem',
        marginBottom: '1rem',
        display: 'flex',
        justifyContent: 'flex-end',
        alignItems: 'center',
      }}
    >
      <label style={{ marginRight: '0.5rem' }}>정렬 :</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="sim">관련도순</option>
        <option value="latest">최신순</option>
        <option value="oldest">오래된순</option>
        <option value="title">제목순</option>
      </select>
    </div>
  );
};

export default SortDropdown;
