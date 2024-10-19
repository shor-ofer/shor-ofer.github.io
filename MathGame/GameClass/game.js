// game.js
import { highScoreManager  } from './highscoreUI.js';
import Sound from './sounds.js';



class Game {

    constructor() {
        this.initialSpawnRate = 8000;
        this.init();
        // Game properties can be added later as needed
    }
    init()
    {
        this.score = 0;
        this.solved = 0;
        this.exercises = [];
        this.level = 1; //+parseInt((8000-this.initialSpawnRate)/500);
        this.gameOver = false;
        this.spawnRate = this.initialSpawnRate; // Set spawn rate to 6 seconds for slower pace
        this.maxExercises = 10; // Game over when there are 10 exercises
        this.initialExercises = 3; // Always start each level with 3 exercises
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

    checkAnswer(playerAnswer,exerciseId,correctAnswer)
    {
        // Only increase score if the answer is correct
        if (playerAnswer === correctAnswer) {
            var deltaScore = this.level;
            this.gameUI.drawDeltaScore(exerciseId,deltaScore);
            this.gameUI.playEffect(Sound.SUCCESS);
            this.exercises = this.exercises.filter(id => id !== exerciseId);
            this.gameUI.removeExercise(exerciseId);
            this.solved++;
            this.score += deltaScore;
            this.gameUI.updateScore();
            this.gameUI.updateSolved();
            if (this.exercises.length)
                this.gameUI.setFocus(this.exercises[0]);
            if (this.exercises.length==0)
                this.levelUp();
        }
        if (playerAnswer.toString().length == correctAnswer.toString().length && 
            playerAnswer !== correctAnswer)
        {
            this.gameUI.playEffect(Sound.ERROR);  
        }


    }
    addExercise() {

        if (this.gameOver) return;
        // Check for game over condition if reaching max exercises
        if (this.exercises.length >= this.maxExercises) {
            this.endGame();
            return;
        }

        var exercise = {};
        const num1 = this.randomNum(1, 10);
        const num2 = this.randomNum(1, 10);
        exercise.num1 = num1;
        exercise.num2 = num2;
        exercise.answer = num1*num2;
        const exerciseId = this.gameUI.addExercise(exercise);
        this.exercises.push(exerciseId);

    }
    levelUp() {
        // Make sure we would not add new exerciseInterval
        clearInterval(this.exerciseInterval);

        // Update level number
        this.level++;

        // Update rate
        this.spawnRate -= 1000; // Increase speed for new exercises
        if (this.spawnRate < 1000) this.spawnRate = 1000; // Cap the speed

        // Start count down and continue in start level
        this.gameUI.startCountdown(this.startLevel.bind(this));
    }

    startLevel() {
        this.exercises = [];  // Clear exercises list for the new level
        this.gameUI.clearExercise();
        this.gameUI.updateLevel();

        // Add exactly 3 exercises at the start of each level
        for (let i = 0; i < this.initialExercises; i++) {
            this.addExercise();
        }    
        // set the focus on the first exercise;
        this.gameUI.setFocus(this.exercises[0]);
        
        // Set an interval to add exercises periodically
        clearInterval(this.exerciseInterval);
        // Set interval and bind to my class as this
        this.exerciseInterval = setInterval(this.addExercise.bind(this), this.spawnRate);        
    }

    endGame() {
        highScoreManager.set(this.score,this.level);
        clearInterval(this.exerciseInterval);
        this.gameOver = true;


        showScreen("gameover-screen");

        this.exercises = [];  // Clear exercises list for the new level
        this.gameUI.clearExercise();

        this.gameUI.stopSound();


        //const gameOverScreen = document.getElementById('game-over-screen');
        //gameOverScreen.textContent = `Game Over! Final Score: ${score}`;
        //gameOverScreen.style.display = 'flex';
    }    
}

export default Game;
