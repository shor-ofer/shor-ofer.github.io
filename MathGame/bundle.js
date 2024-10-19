(() => {
  // GameClass/highscore.js
  var HighScoreManager = class {
    constructor() {
      this.highScoreKey = "gameHighScore";
      this.levelKey = "gameLevel";
      this.solvedKey = "gameSolved";
      this.highScore = 0;
      this.level = 0;
      this.solved = 0;
      this.load();
    }
    // Load the high score from local storage
    load() {
      const storedHighScore = localStorage.getItem(this.highScoreKey);
      this.highScore = storedHighScore ? parseInt(storedHighScore, 10) : 0;
      const storedLevel = localStorage.getItem(this.levelKey);
      this.level = storedLevel ? parseInt(storedLevel, 10) : 0;
      const storedSolved = localStorage.getItem(this.solvedKey);
      this.solved = storedSolved ? parseInt(storedSolved, 10) : 0;
    }
    // Get the current high score
    getHighScore() {
      return this.highScore;
    }
    // Get the current level
    getLevel() {
      return this.level;
    }
    getSolved() {
      return this.solved;
    }
    // Set a new score, update if it's higher than the current high score
    set(newScore, solved, newLevel) {
      if (newScore >= this.highScore) {
        this.solved = solved;
        this.highScore = newScore;
        if (newLevel > this.level)
          this.level = newLevel;
        this.save();
      }
    }
    // Save the high score to local storage
    save() {
      localStorage.setItem(this.highScoreKey, this.highScore);
      localStorage.setItem(this.levelKey, this.level);
      localStorage.setItem(this.solvedKey, this.solved);
    }
    // Reset the high score
    reset() {
      this.highScore = 0;
      this.level = 0;
      this.solved = 0;
      this.save();
    }
  };
  var highscore_default = HighScoreManager;

  // GameClass/highscoreUI.js
  var HighScoreUI = class {
    constructor(highScoreManager2) {
      this.highScoreManager = highScoreManager2;
      this.highScoreDisplay = document.getElementById("high-score-display");
      this.solvedDisplay = document.getElementById("solved-display");
      this.levelDisplay = document.getElementById("level-display");
    }
    // Update the high score UI
    updateHighScore() {
      this.highScoreDisplay.textContent = `High Score: ${this.highScoreManager.getHighScore()}`;
      this.solvedDisplay.textContent = `Solved: ${this.highScoreManager.getSolved()}`;
      this.levelDisplay.textContent = `Level: ${this.highScoreManager.getLevel()}`;
    }
    // This will be called when the high score screen is opened
    onShow() {
      this.updateHighScore();
    }
  };
  var TestHighScore = class {
    constructor(highScoreManager2) {
      this.highScoreManager = highScoreManager2;
      this.scoreInput = document.getElementById("test-score-input");
      this.solvedInput = document.getElementById("test-solved-input");
      this.levelInput = document.getElementById("test-level-input");
      this.setScoreBtn = document.getElementById("set-score-btn");
      this.resetTestHighScoreBtn = document.getElementById("reset-test-highscore");
      this.setScoreBtn.addEventListener("click", () => this.setScore());
      this.resetTestHighScoreBtn.addEventListener("click", () => this.resetHighScore());
    }
    // Set a new score using the input value
    setScore() {
      const newScore = parseInt(this.scoreInput.value, 10);
      const newSolved = parseInt(this.solvedInput.value, 10);
      const newLevel = parseInt(this.levelInput.value, 10);
      if (!isNaN(newScore) && !isNaN(newLevel)) {
        this.highScoreManager.set(newScore, newSolved, newLevel);
      }
      this.updateUI();
    }
    // Reset the high score
    resetHighScore() {
      this.highScoreManager.reset();
      this.updateUI();
    }
    updateUI() {
      this.scoreInput.value = this.highScoreManager.getHighScore();
      this.solvedInput.value = this.highScoreManager.getSolved();
      this.levelInput.value = this.highScoreManager.getLevel();
    }
    // Called when the test screen is opened (if any setup is needed)
    onShow() {
      this.updateUI();
    }
  };
  var highScoreManager = new highscore_default();
  var highScoreUI = new HighScoreUI(highScoreManager);
  var testHighScore = new TestHighScore(highScoreManager);

  // GameClass/sounds.js
  var Sound = {
    SUCCESS: "Assets/success-1-6297.mp3",
    ERROR: "Assets/error-4-199275.mp3",
    COUNTDOWN: "Assets/countdown-sound-effect-8-bit-151797.mp3",
    GAMEOVER: "Assets/brass-fail-11-a-207140.mp3"
  };
  var sounds_default = Sound;

  // GameClass/game.js
  var Game = class {
    constructor() {
      this.initialSpawnRate = 8e3;
      this.maxi = 10;
      this.maxj = 10;
      this.init();
    }
    init() {
      this.score = 0;
      this.solved = 0;
      this.exercises = [];
      this.level = 1;
      this.gameOver = false;
      this.spawnRate = this.initialSpawnRate;
      this.maxExercises = 10;
      this.initialExercises = 3;
      this.exerciseInterval;
    }
    start() {
      this.gameUI.playSound();
      this.init();
      this.gameUI.clearExercise();
      this.gameUI.updateScore();
      this.gameUI.updateSolved();
      this.startLevel();
    }
    randomNum(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    checkAnswer(playerAnswer, exerciseId, correctAnswer) {
      if (playerAnswer === correctAnswer) {
        var deltaScore = this.level;
        this.gameUI.drawDeltaScore(exerciseId, deltaScore);
        this.gameUI.playEffect(sounds_default.SUCCESS);
        this.exercises = this.exercises.filter((id) => id !== exerciseId);
        this.gameUI.removeExercise(exerciseId);
        this.solved++;
        this.score += deltaScore;
        this.gameUI.updateScore();
        this.gameUI.updateSolved();
        if (this.exercises.length)
          this.gameUI.setFocus(this.exercises[0]);
        if (this.exercises.length == 0)
          this.levelUp();
      }
      if (playerAnswer.toString().length == correctAnswer.toString().length && playerAnswer !== correctAnswer) {
        this.gameUI.playEffect(sounds_default.ERROR);
      }
    }
    addExercise() {
      if (this.gameOver) return;
      if (this.exercises.length >= this.maxExercises) {
        this.endGame();
        return;
      }
      var exercise = {};
      const num1 = this.randomNum(1, this.maxi);
      const num2 = this.randomNum(1, this.maxj);
      exercise.num1 = num1;
      exercise.num2 = num2;
      exercise.answer = num1 * num2;
      const exerciseId = this.gameUI.addExercise(exercise);
      this.exercises.push(exerciseId);
    }
    levelUp() {
      clearInterval(this.exerciseInterval);
      this.level++;
      this.spawnRate -= 1e3;
      if (this.spawnRate < 1e3) this.spawnRate = 1e3;
      this.gameUI.startCountdown(this.startLevel.bind(this));
    }
    startLevel() {
      this.exercises = [];
      this.gameUI.clearExercise();
      this.gameUI.updateLevel();
      for (let i = 0; i < this.initialExercises; i++) {
        this.addExercise();
      }
      this.gameUI.setFocus(this.exercises[0]);
      clearInterval(this.exerciseInterval);
      this.exerciseInterval = setInterval(this.addExercise.bind(this), this.spawnRate);
    }
    endGame() {
      highScoreManager.set(this.score, this.level);
      clearInterval(this.exerciseInterval);
      this.gameOver = true;
      showScreen("gameover-screen");
      this.exercises = [];
      this.gameUI.clearExercise();
      this.gameUI.stopSound();
    }
  };
  var game_default = Game;

  // GameClass/gameUI.js
  var GameUI = class {
    constructor(game2) {
      game2.gameUI = this;
      this.game = game2;
      this.countdownDisplay = document.getElementById("countdown-display");
      this.intervalId = null;
      this.gameContainer = document.getElementById("game-container");
      this.incId = 0;
      document.getElementById("game-container").addEventListener("input", (e) => {
        if (e.target.classList.contains("answer")) {
          checkAnswer(e.target);
        }
      });
    }
    removeExercise(exerciseId) {
      this.updateExercisesColor();
      document.getElementById(exerciseId).classList.add("fade-out");
      setTimeout(() => {
        document.getElementById(exerciseId).remove();
      }, 300);
    }
    setFocus(exerciseId) {
      document.getElementById(exerciseId).querySelector("#answer").focus();
    }
    updateScore() {
      document.getElementById("score-value").textContent = this.game.score;
    }
    updateLevel() {
      document.getElementById("level-value").textContent = this.game.level;
    }
    updateSolved() {
      document.getElementById("solved-value").textContent = this.game.solved;
    }
    addExercise(e) {
      const exerciseId = `exercise-${++this.incId}`;
      const div = document.createElement("div");
      div.className = "exercise";
      div.id = exerciseId;
      div.innerHTML = `${e.num1} x ${e.num2} = <input id="answer" type="number" class="answer" data-answer="${e.answer}" data-id="${exerciseId}">`;
      this.gameContainer.appendChild(div);
      this.updateExercisesColor();
      return exerciseId;
    }
    updateExercisesColor() {
      var ratio = Math.max(0, this.game.exercises.length - 0 * this.game.initialExercises) / (this.game.maxExercises - 0 * this.game.initialExercises);
      ratio = 1 - (1 - ratio) * (1 - ratio);
      var val = ratio * (360 - 197) + 197;
      var color = `hsl(${val}, 58%, 48%)`;
      document.querySelector("#game-container").style.backgroundColor = color;
    }
    clearExercise() {
      this.gameContainer.innerHTML = "";
      this.updateExercisesColor();
    }
    updateCountDown(count) {
      this.countdown = count;
      this.countdownDisplay.innerHTML = `<span>Level:${this.game.level}<br/>${count.toString()}</span>`;
    }
    startCountdown(onCountDownFinishFunction) {
      this.updateCountDown(3);
      this.playEffect(sounds_default.COUNTDOWN);
      this.countdownDisplay.style.display = "flex";
      clearInterval(this.intervalId);
      this.intervalId = setInterval(() => {
        this.updateCountDown(this.countdown - 1);
        if (this.countdown == 0) {
          clearInterval(this.intervalId);
          this.countdownDisplay.style.display = "none";
          onCountDownFinishFunction();
        }
      }, 1e3);
    }
    // Called when the test screen is opened (if any setup is needed)
    onShow() {
      this.game.init();
      this.startCountdown(this.game.start.bind(this.game));
    }
    playEffect(name) {
      var e_effect = document.getElementById("effect");
      var audio = document.getElementById("mp3Effect");
      audio.src = name;
      e_effect.load();
      e_effect.sorce;
      e_effect.volume = 0.5;
      e_effect.play().catch((error) => {
      });
    }
    stopEffect() {
      var e_effect = document.getElementById("effect");
      e_effect.pause();
      e_effect.currentTime = 0;
    }
    playSound() {
      var e_snd = document.getElementById("snd");
      e_snd.volume = 0.2;
      e_snd.play();
    }
    stopSound() {
      var e_snd = document.getElementById("snd");
      e_snd.pause();
      e_snd.currentTime = 0;
    }
    drawDeltaScore(exerciseId, deltascore) {
      var targetElement = document.getElementById(exerciseId);
      const floatingNumber = document.createElement("div");
      floatingNumber.className = "floatingNumber";
      floatingNumber.innerText = `+${deltascore}`;
      const rect = targetElement.getBoundingClientRect();
      floatingNumber.style.left = `${rect.left + rect.width / 2}px`;
      floatingNumber.style.top = `${rect.top}px`;
      document.body.appendChild(floatingNumber);
      setTimeout(() => {
        floatingNumber.style.transform = "translateY(-30px)";
        floatingNumber.style.opacity = "0";
      }, 0);
      setTimeout(() => {
        document.body.removeChild(floatingNumber);
      }, 500);
    }
  };
  var game = new game_default();
  var gameUI = new GameUI(game);
  function checkAnswer(input) {
    const playerAnswer = parseInt(input.value);
    const correctAnswer = parseInt(input.dataset.answer);
    const exerciseId = input.dataset.id;
    game.checkAnswer(playerAnswer, exerciseId, correctAnswer);
  }

  // GameClass/gameoverUI.js
  var GameOverUI = class {
    constructor() {
      this.highScoreDisplay = document.getElementById("gameover-score-display");
      this.solvedDisplay = document.getElementById("gameover-solved-display");
      this.levelDisplay = document.getElementById("gameover-level-display");
    }
    // This will be called when game over screen is opened
    onShow() {
      gameUI.playEffect(sounds_default.GAMEOVER);
      this.highScoreDisplay.textContent = game.score;
      this.solvedDisplay.textContent = game.solved;
      this.levelDisplay.textContent = game.level;
    }
  };
  var gameoverUI = new GameOverUI();

  // GameClass/optionsUI.js
  var OPTION_EASY = 8e3;
  var OPTION_MEDIUM = 5e3;
  var OPTION_HARD = 3e3;
  var OptionsUI = class {
    constructor() {
      this.easyBtn = document.getElementById("options-easy");
      this.mediumBtn = document.getElementById("options-medium");
      this.hardBtn = document.getElementById("options-hard");
      this.btnList = [this.easyBtn, this.mediumBtn, this.hardBtn];
      this.optionList = [OPTION_EASY, OPTION_MEDIUM, OPTION_HARD];
      for (let i = 0; i < this.btnList.length; i++)
        this.btnList[i].addEventListener("click", () => this.select(i));
    }
    select(value) {
      this.setOption(this.optionList[value]);
      for (let i = 0; i < this.btnList.length; i++) {
        if (i == value)
          this.btnList[i].classList.add("select");
        else
          this.btnList[i].classList.remove("select");
      }
    }
    setOption(value) {
      game.initialSpawnRate = value;
    }
    // This will be called when game over screen is opened
    onShow() {
      for (let i = 0; i < this.optionList.length; i++) {
        if (game.initialSpawnRate == this.optionList[i]) {
          this.select(i);
          break;
        }
      }
    }
  };
  var optionsUI = new OptionsUI();

  // GameClass/rangeUI.js
  var RangeUI = class {
    constructor() {
    }
    createTable() {
      const table = document.getElementById("multiplicationTable");
      table.innerHTML = "";
      for (let i = 1; i <= 10; i++) {
        const row = document.createElement("tr");
        for (let j = 1; j <= 10; j++) {
          const cell = document.createElement("td");
          cell.textContent = i * j;
          cell.dataset.row = i;
          cell.dataset.col = j;
          cell.style.cursor = "pointer";
          if (i == 1 || j == 1)
            cell.classList.add("c1i");
          else
            cell.classList.add("c1");
          cell.addEventListener("click", () => {
            gameUI.playEffect(sounds_default.SUCCESS);
            this.colorCells(i, j);
            game.maxi = i;
            game.maxj = j;
          });
          row.appendChild(cell);
        }
        table.appendChild(row);
      }
    }
    colorCells(row, col) {
      const cells = document.querySelectorAll("td");
      cells.forEach((cell) => {
        const cellRow = parseInt(cell.dataset.row);
        const cellCol = parseInt(cell.dataset.col);
        if (cellRow <= row && cellCol <= col) {
          cell.classList.remove("c1");
          cell.classList.remove("c1i");
          if (cellRow == 1 || cellCol == 1)
            cell.classList.add("c2i");
          else
            cell.classList.add("c2");
        } else {
          cell.classList.remove("c2");
          cell.classList.remove("c2i");
          if (cellRow == 1 || cellCol == 1)
            cell.classList.add("c1i");
          else
            cell.classList.add("c1");
        }
      });
    }
    onShow() {
      this.createTable();
      this.colorCells(game.maxi, game.maxj);
    }
  };
  var rangeUI = new RangeUI();

  // gamemanager.js
  function showScreen2(screenId) {
    document.querySelectorAll(".screen").forEach((screen2) => {
      screen2.classList.remove("active");
    });
    const screen = document.getElementById(screenId);
    screen.classList.add("active");
    if (screenId === "highscore-screen") {
      highScoreUI.onShow();
    } else if (screenId === "game-screen") {
      gameUI.onShow();
    } else if (screenId === "test-highscore-screen") {
      testHighScore.onShow();
    } else if (screenId === "gameover-screen") {
      gameoverUI.onShow();
    } else if (screenId === "options-screen") {
      optionsUI.onShow();
    } else if (screenId === "range-screen") {
      rangeUI.onShow();
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    showScreen2("open-screen");
  });
  window.showScreen = showScreen2;
})();
