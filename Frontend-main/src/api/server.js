// src/api.ts
import axios from 'axios';

const api = axios.create({
  baseURL: 'https://read-with-dev-env.eba-wuzcb2s6.ap-northeast-2.elasticbeanstalk.com', // 쿠키 사용하는 경우
});

export default api;
