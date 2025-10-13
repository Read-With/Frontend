#!/usr/bin/env node

/**
 * 메모리 최적화 스크립트
 * 이 스크립트를 실행하여 프로젝트의 메모리 사용량을 최적화합니다.
 */

const fs = require('fs');
const path = require('path');

console.log('🚀 메모리 최적화 스크립트 시작...\n');

// 1. 캐시 정리
function cleanCache() {
  console.log('📦 캐시 정리 중...');
  const cacheDirs = [
    'node_modules/.vite',
    'node_modules/.cache',
    'dist',
    '.eslintcache'
  ];
  
  cacheDirs.forEach(dir => {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`✅ ${dir} 삭제 완료`);
    }
  });
}

// 2. 메모리 최적화된 설정 파일 생성
function createOptimizedConfigs() {
  console.log('\n⚙️  최적화된 설정 파일 생성 중...');
  
  // .gitignore에 메모리 관련 파일 추가
  const gitignorePath = '.gitignore';
  const gitignoreContent = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';
  
  if (!gitignoreContent.includes('.eslintcache')) {
    fs.appendFileSync(gitignorePath, '\n# Memory optimization\n.eslintcache\n*.log\n');
    console.log('✅ .gitignore 업데이트 완료');
  }
  
  // 메모리 모니터링 스크립트 생성
  const monitorScript = `#!/bin/bash
# 메모리 사용량 모니터링 스크립트
echo "🔍 메모리 사용량 모니터링 시작..."
echo "PID: $$"
echo "Node.js 메모리 사용량:"
ps -o pid,ppid,rss,vsz,comm -p $$
echo ""
echo "프로젝트 디렉토리 크기:"
du -sh . 2>/dev/null || echo "디렉토리 크기 계산 실패"
`;
  
  fs.writeFileSync('monitor-memory.sh', monitorScript);
  fs.chmodSync('monitor-memory.sh', '755');
  console.log('✅ 메모리 모니터링 스크립트 생성 완료');
}

// 3. package.json 스크립트 최적화
function optimizePackageScripts() {
  console.log('\n📝 package.json 스크립트 최적화 중...');
  
  const packagePath = 'package.json';
  if (fs.existsSync(packagePath)) {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    
    // 메모리 최적화된 스크립트 추가
    packageJson.scripts = {
      ...packageJson.scripts,
      'dev:memory': 'cross-env NODE_OPTIONS="--max-old-space-size=4096" vite',
      'build:memory': 'cross-env NODE_OPTIONS="--max-old-space-size=8192" vite build',
      'clean:memory': 'npm run clean && rm -rf .eslintcache node_modules/.vite',
      'monitor': 'bash monitor-memory.sh'
    };
    
    fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
    console.log('✅ package.json 스크립트 최적화 완료');
  }
}

// 4. 메모리 사용량 체크
function checkMemoryUsage() {
  console.log('\n📊 현재 메모리 사용량:');
  const memUsage = process.memoryUsage();
  console.log(`RSS: ${Math.round(memUsage.rss / 1024 / 1024)} MB`);
  console.log(`Heap Used: ${Math.round(memUsage.heapUsed / 1024 / 1024)} MB`);
  console.log(`Heap Total: ${Math.round(memUsage.heapTotal / 1024 / 1024)} MB`);
  console.log(`External: ${Math.round(memUsage.external / 1024 / 1024)} MB`);
}

// 실행
try {
  cleanCache();
  createOptimizedConfigs();
  optimizePackageScripts();
  checkMemoryUsage();
  
  console.log('\n🎉 메모리 최적화 완료!');
  console.log('\n📋 다음 단계:');
  console.log('1. npm run dev:memory 로 개발 서버 시작');
  console.log('2. npm run monitor 로 메모리 사용량 모니터링');
  console.log('3. IDE를 재시작하여 설정 적용');
  
} catch (error) {
  console.error('❌ 최적화 중 오류 발생:', error.message);
  process.exit(1);
}
