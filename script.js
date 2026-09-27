// === DOM 요소 가져오기 ===
const canvas = document.getElementById('tetris-canvas');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreElement = document.getElementById('score');
const levelElement = document.getElementById('level');
const overlay = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');
const overlayTitle = document.getElementById('overlay-title');
const overlayDesc = document.getElementById('overlay-desc');
const startLevelInput = document.getElementById('start-level');
const startLevelDisplay = document.getElementById('start-level-display');

// 슬라이더 막대를 조절할 때마다 화면의 숫자를 실시간으로 변경해주는 이벤트
startLevelInput.addEventListener('input', (event) => {
    startLevelDisplay.innerText = event.target.value;
});

// === 게임 설정 상수 ===
const ROWS = 20;     // 보드의 가로 줄 수 (세로 칸)
const COLS = 10;     // 보드의 세로 줄 수 (가로 칸)
const BLOCK_SIZE = 30; // 한 블록의 크기 (픽셀)

// 데스 라인(죽는 선) 위치 설정 (위에서 2번째 줄 아래를 경계로 설정)
const DANGER_LINE_Y = 2 * BLOCK_SIZE; 

// 메인 캔버스 크기를 블록 크기에 맞게 조정
canvas.width = COLS * BLOCK_SIZE;
canvas.height = ROWS * BLOCK_SIZE;

// 다음 블록 캔버스의 블록 크기는 약간 작게 설정
const NEXT_BLOCK_SIZE = 25;

// === 🎵 사운드 매니저 (Web Audio API) ===
const SoundManager = {
    ctx: null,
    
    init() {
        if (!this.ctx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    },

    playTone(type, freq, duration, vol = 0.1) {
        if (!this.ctx) return;
        
        const oscillator = this.ctx.createOscillator();
        const gainNode = this.ctx.createGain();
        
        oscillator.type = type;
        oscillator.frequency.setValueAtTime(freq, this.ctx.currentTime);
        
        gainNode.gain.setValueAtTime(vol, this.ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        
        oscillator.connect(gainNode);
        gainNode.connect(this.ctx.destination);
        
        oscillator.start();
        oscillator.stop(this.ctx.currentTime + duration);
    },

    playMoveSound() {
        this.playTone('triangle', 150, 0.1, 0.1);
    },
    playRotateSound() {
        this.playTone('square', 300, 0.1, 0.05);
    },
    playDropSound() {
        this.playTone('square', 100, 0.15, 0.1);
    },
    playClearSound() {
        this.playTone('sine', 600, 0.1, 0.1);
        setTimeout(() => this.playTone('sine', 800, 0.2, 0.1), 100);
    },
    
    // 🍄 마리오가 죽는 특유의 멜로디 (주파수 배열을 이용한 연주)
    playGameOverSound() {
        const notes = [
            { freq: 494, duration: 0.15, delay: 0 },    // B4 
            { freq: 698, duration: 0.15, delay: 150 },  // F5 
            { freq: 698, duration: 0.15, delay: 450 },  // F5 
            { freq: 698, duration: 0.15, delay: 600 },  // F5 
            { freq: 659, duration: 0.15, delay: 750 },  // E5 
            { freq: 587, duration: 0.15, delay: 900 },  // D5 
            { freq: 523, duration: 0.40, delay: 1050 }  // C5 
        ];

        notes.forEach(note => {
            setTimeout(() => {
                this.playTone('square', note.freq, note.duration, 0.15);
            }, note.delay);
        });
    }
};

// === 테트로미노(블록) 정의 ===
const SHAPES = {
    I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    J: [[1,0,0],[1,1,1],[0,0,0]],
    L: [[0,0,1],[1,1,1],[0,0,0]],
    O: [[1,1],[1,1]],
    S: [[0,1,1],[1,1,0],[0,0,0]],
    Z: [[1,1,0],[0,1,1],[0,0,0]],
    T: [[0,1,0],[1,1,1],[0,0,0]]
};

const COLORS = {
    I: '#00f3ff', J: '#0051ff', L: '#ffaa00', 
    O: '#ffea00', S: '#00ff33', Z: '#ff003c', T: '#b700ff'
};

const SHAPE_NAMES = Object.keys(SHAPES);

// === 게임 상태 변수들 ===
let board = [];
let currentPiece = null;
let nextPiece = null;
let score = 0;
let level = 1;
let baseLevel = 1; // 사용자가 처음 선택한 시작 레벨 저장용
let dropCounter = 0;
let dropInterval = 1000;
let lastTime = 0;
let requestAnimationId = null;
let isGameOver = false;

// === 게임 로직 함수들 ===

function createBoard() {
    board = [];
    for (let r = 0; r < ROWS; r++) {
        board.push(new Array(COLS).fill(0));
    }
}

function getRandomPiece() {
    const randIndex = Math.floor(Math.random() * SHAPE_NAMES.length);
    const name = SHAPE_NAMES[randIndex];
    const shape = SHAPES[name];
    
    return {
        name: name,
        shape: shape,
        color: COLORS[name],
        x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2),
        y: 0
    };
}

function checkCollision(piece, board) {
    for (let r = 0; r < piece.shape.length; r++) {
        for (let c = 0; c < piece.shape[r].length; c++) {
            if (piece.shape[r][c]) {
                const newX = piece.x + c;
                const newY = piece.y + r;
                
                if (newX < 0 || newX >= COLS || newY >= ROWS) return true;
                if (newY >= 0 && board[newY][newX] !== 0) return true;
            }
        }
    }
    return false;
}

// 👻 고스트 피스(바닥 가이드 선)의 Y 위치를 계산하는 함수
function getGhostY() {
    if (!currentPiece) return 0;
    
    // 현재 블록의 복사본(고스트) 생성
    const ghostPiece = {
        shape: currentPiece.shape,
        x: currentPiece.x,
        y: currentPiece.y
    };
    
    // 바닥이나 다른 블록에 충돌할 때까지 한 칸씩 아래로 내려봄
    while (true) {
        ghostPiece.y++;
        if (checkCollision(ghostPiece, board)) {
            // 충돌했다면 그 직전 위치가 최종 바닥 위치임
            ghostPiece.y--;
            break;
        }
    }
    return ghostPiece.y;
}

function lockPiece() {
    if (isGameOver) return; 

    SoundManager.playDropSound();

    for (let r = 0; r < currentPiece.shape.length; r++) {
        for (let c = 0; c < currentPiece.shape[r].length; c++) {
            if (currentPiece.shape[r][c]) {
                if (currentPiece.y + r < 2) {
                    gameOver();
                    return; 
                }
                board[currentPiece.y + r][currentPiece.x + c] = currentPiece.color;
            }
        }
    }
    
    clearLines();
    
    currentPiece = nextPiece;
    nextPiece = getRandomPiece();
    
    if (checkCollision(currentPiece, board)) {
        gameOver();
    }
}

function clearLines() {
    let linesCleared = 0;
    
    outer: for (let r = ROWS - 1; r >= 0; r--) {
        for (let c = 0; c < COLS; c++) {
            if (board[r][c] === 0) continue outer;
        }
        
        board.splice(r, 1);
        board.unshift(new Array(COLS).fill(0));
        
        linesCleared++;
        r++; 
    }
    
    if (linesCleared > 0) {
        SoundManager.playClearSound();
        score += linesCleared * 100 * linesCleared; 
        scoreElement.innerText = score;
        
        // 사용자가 처음에 선택한 시작 레벨(baseLevel)을 기준으로 점수에 따른 추가 레벨업 계산
        const newLevel = baseLevel + Math.floor(score / 1000);
        if (newLevel > level) {
            level = newLevel;
            levelElement.innerText = level;
            dropInterval = Math.max(100, 1000 - (level - 1) * 100);
        }
    }
}

function rotateMatrix(matrix) {
    const N = matrix.length;
    const result = Array.from({ length: N }, () => new Array(N).fill(0));
    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            result[c][N - 1 - r] = matrix[r][c];
        }
    }
    return result;
}

// === 그리기 (Rendering) 함수들 ===

// 일반 블록 그리기
function drawBlock(context, x, y, size, color) {
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.shadowBlur = 10;
    context.shadowColor = color;
    context.strokeRect(x * size, y * size, size, size);
    
    context.fillStyle = color + '40'; 
    context.fillRect(x * size, y * size, size, size);
    
    context.shadowBlur = 0;
}

// 👻 고스트 피스(가이드 선) 그리기
function drawGhostBlock(context, x, y, size, color) {
    context.strokeStyle = color;
    context.lineWidth = 1.5;
    // 사용자의 요청에 따라 점선 대신 실선으로 그립니다
    context.strokeRect(x * size, y * size, size, size);
    
    // 내부는 아주아주 연하게 칠하기 (투명도 20%)
    context.fillStyle = color + '20'; 
    context.fillRect(x * size, y * size, size, size);
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 1) 고정된 블록 그리기
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            if (board[r][c] !== 0) {
                drawBlock(ctx, c, r, BLOCK_SIZE, board[r][c]);
            }
        }
    }
    
    // 👻 2) 떨어질 위치를 알려주는 고스트 피스 그리기
    if (currentPiece && !isGameOver) {
        const ghostY = getGhostY();
        for (let r = 0; r < currentPiece.shape.length; r++) {
            for (let c = 0; c < currentPiece.shape[r].length; c++) {
                if (currentPiece.shape[r][c]) {
                    // 고스트 피스를 그립니다
                    drawGhostBlock(ctx, currentPiece.x + c, ghostY + r, BLOCK_SIZE, currentPiece.color);
                }
            }
        }
    }

    // 3) 떨어지는 현재 블록 그리기 (고스트 피스 위에 덮어쓰도록 나중에 그림)
    if (currentPiece && !isGameOver) {
        for (let r = 0; r < currentPiece.shape.length; r++) {
            for (let c = 0; c < currentPiece.shape[r].length; c++) {
                if (currentPiece.shape[r][c]) {
                    drawBlock(ctx, currentPiece.x + c, currentPiece.y + r, BLOCK_SIZE, currentPiece.color);
                }
            }
        }
    }

    // 🔴 4) 죽는 선 (Danger Line) 그리기
    ctx.beginPath();
    ctx.moveTo(0, DANGER_LINE_Y);
    ctx.lineTo(canvas.width, DANGER_LINE_Y);
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;
    // 사용자의 요청에 따라 점선 대신 실선으로 그립니다
    ctx.shadowBlur = 10;
    ctx.shadowColor = 'red';
    ctx.stroke();
    ctx.shadowBlur = 0;
    
    // 5) 다음 블록 그리기
    drawNextPiece();
}

function drawNextPiece() {
    nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
    
    if (nextPiece && !isGameOver) {
        const shape = nextPiece.shape;
        const offsetX = (nextCanvas.width - shape[0].length * NEXT_BLOCK_SIZE) / 2;
        const offsetY = (nextCanvas.height - shape.length * NEXT_BLOCK_SIZE) / 2;
        
        for (let r = 0; r < shape.length; r++) {
            for (let c = 0; c < shape[r].length; c++) {
                if (shape[r][c]) {
                    nextCtx.strokeStyle = nextPiece.color;
                    nextCtx.lineWidth = 2;
                    nextCtx.shadowBlur = 10;
                    nextCtx.shadowColor = nextPiece.color;
                    
                    const drawX = offsetX + c * NEXT_BLOCK_SIZE;
                    const drawY = offsetY + r * NEXT_BLOCK_SIZE;
                    
                    nextCtx.strokeRect(drawX, drawY, NEXT_BLOCK_SIZE, NEXT_BLOCK_SIZE);
                    nextCtx.fillStyle = nextPiece.color + '40';
                    nextCtx.fillRect(drawX, drawY, NEXT_BLOCK_SIZE, NEXT_BLOCK_SIZE);
                    nextCtx.shadowBlur = 0;
                }
            }
        }
    }
}

// === 게임 흐름 제어 ===

function update(time = 0) {
    if (isGameOver) return; 
    
    let deltaTime = time - lastTime;
    if (deltaTime > 100) deltaTime = 100; 
    lastTime = time;
    
    dropCounter += deltaTime;
    
    if (dropCounter > dropInterval) {
        currentPiece.y++; 
        
        if (checkCollision(currentPiece, board)) {
            currentPiece.y--; 
            lockPiece();      
        }
        
        dropCounter = 0; 
    }
    
    draw(); 
    requestAnimationId = requestAnimationFrame(update);
}

// 키보드 조작
document.addEventListener('keydown', event => {
    if (isGameOver) return;
    
    switch (event.key) {
        case 'ArrowLeft':
            currentPiece.x--;
            if (checkCollision(currentPiece, board)) currentPiece.x++; 
            else {
                SoundManager.playMoveSound(); 
                draw(); // 이동 즉시 고스트 피스 갱신을 위해 다시 그림
            }
            break;
            
        case 'ArrowRight':
            currentPiece.x++;
            if (checkCollision(currentPiece, board)) currentPiece.x--;
            else {
                SoundManager.playMoveSound(); 
                draw();
            }
            break;
            
        case 'ArrowDown':
            currentPiece.y++;
            if (checkCollision(currentPiece, board)) {
                currentPiece.y--;
                lockPiece();
            } else {
                SoundManager.playMoveSound(); 
            }
            dropCounter = 0;
            break;
            
        case 'ArrowUp':
            const rotatedShape = rotateMatrix(currentPiece.shape);
            const originalShape = currentPiece.shape;
            const originalX = currentPiece.x;
            
            currentPiece.shape = rotatedShape;
            let canRotate = false;
            
            const offsets = [0, 1, -1, 2, -2]; 
            
            for (let i = 0; i < offsets.length; i++) {
                currentPiece.x = originalX + offsets[i];
                if (!checkCollision(currentPiece, board)) {
                    canRotate = true;
                    break; 
                }
            }
            
            if (canRotate) {
                SoundManager.playRotateSound(); 
                draw(); // 회전 즉시 고스트 피스 갱신을 위해 다시 그림
            } else {
                currentPiece.shape = originalShape;
                currentPiece.x = originalX;
            }
            break;
    }
});

// === 시작 및 재시작 종료 처리 ===

function startGame() {
    SoundManager.init();

    createBoard();
    score = 0;
    
    // 슬라이더에서 선택한 값을 숫자로 바꿔서 시작 레벨로 설정
    baseLevel = parseInt(startLevelInput.value, 10);
    level = baseLevel;
    
    // 선택한 레벨이 높을수록 초기 속도를 빠르게(시간을 짧게) 설정
    dropInterval = Math.max(100, 1000 - (level - 1) * 100);
    dropCounter = 0;
    isGameOver = false;
    
    scoreElement.innerText = score;
    levelElement.innerText = level;
    
    currentPiece = getRandomPiece();
    nextPiece = getRandomPiece();
    
    overlay.classList.add('hidden');
    
    if (requestAnimationId) cancelAnimationFrame(requestAnimationId);
    
    lastTime = performance.now(); 
    update(lastTime); 
}

function gameOver() {
    if (isGameOver) return; 
    isGameOver = true;
    
    if (requestAnimationId) cancelAnimationFrame(requestAnimationId);
    
    SoundManager.playGameOverSound();

    overlay.classList.remove('hidden');
    overlayTitle.innerText = 'GAME OVER';
    overlayTitle.style.color = '#ff003c';
    overlayTitle.style.textShadow = '0 0 10px #fff, 0 0 20px #ff003c';
    overlayDesc.innerText = `최종 점수: ${score}`;
    startBtn.innerText = 'RESTART';
    
    draw(); 
}

startBtn.addEventListener('click', startGame);

createBoard();
draw();
