import axios from 'axios';

export const searchBooks = async (query, start = 1) => {
  const res = await axios.get(`/naver?query=${encodeURIComponent(query)}&start=${start}`);
  return res.data;
};