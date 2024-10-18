// gameUI.js
import Game from './game.js';
import Sound from './Sounds.js';



class GameUI {
    constructor(game) {

        //bind ui to game
        game.gameUI = this;
        this.game = game; // Set a Game instance

        this.countdownDisplay = document.getElementById('countdown-display'); // Element to display countdown
        this.intervalId = null; // To hold the interval ID
        this.gameContainer = document.getElementById('game-container');
        this.incId=0;

        // Listen for answer input changes
        document.getElementById('game-container').addEventListener('input', (e) => {
        if (e.target.classList.contains('answer')) {
            checkAnswer(e.target);
        }
    });        
    }

    removeExercise(exerciseId)
    {
        document.getElementById(exerciseId).classList.add('fade-out');
        setTimeout(() => {
            document.getElementById(exerciseId).remove();
        }, 300); // delay for fade-out animation
    }

    updateScore()
    {
        document.getElementById('score-value').textContent = this.game.score;
    }
    updateLevel()
    {
        document.getElementById('level-value').textContent = this.game.level;
    }

    addExercise(e)  {

        const exerciseId = `exercise-${++this.incId}`;
        const div = document.createElement('div');
        div.className = 'exercise';
        div.id = exerciseId;
        div.innerHTML = `${e.num1} x ${e.num2} = <input type="number" class="answer" data-answer="${e.answer}" data-id="${exerciseId}">`;
        this.gameContainer.appendChild(div);
        return exerciseId;
    }
    clearExercise() {
        this.gameContainer.innerHTML="";
    }

    updateCountDown(count) {
        this.countdown = count;
        this.countdownDisplay.innerHTML = `<span>Level:${this.game.level}<br/>${count.toString()}</span>`; // Update countdown display
    }

    startCountdown(onCountDownFinishFunction) {
        this.updateCountDown(3); // Reset countdown
        this.playEffect(Sound.COUNTDOWN);
        this.countdownDisplay.style.display = 'flex'; // Show countdown display
        clearInterval(this.intervalId);
        this.intervalId = setInterval(() => {
            this.updateCountDown(this.countdown-1); // Decrement countdown
            if (this.countdown==0)
            {
                //this.stopEffect();
                clearInterval(this.intervalId); // Clear the interval
                this.countdownDisplay.style.display = 'none'; // Hide countdown display
                onCountDownFinishFunction(); // Start the game

            }
        }, 1000); // Countdown every second
    }


    // Called when the test screen is opened (if any setup is needed)
    onShow() {
        // Any additional UI setup for the test screen can go here
        this.startCountdown(this.game.start.bind(this.game));
    }
    playEffect(name)
    {
        var e_effect = document.getElementById("effect");

        var audio = document.getElementById('mp3Effect');
        audio.src = name;
        e_effect.load();

        e_effect.sorce
        e_effect.volume=1.0;
        e_effect.play();
    
    }
    stopEffect()
    {
        var e_effect = document.getElementById("effect");
        e_effect.pause();
        e_effect.currentTime=0;  

    }
    playSound()
    {
        var e_snd = document.getElementById("snd");
        e_snd.volume=0.2;
        e_snd.play();
    }
    stopSound()
    {
        var e_snd = document.getElementById("snd");
        e_snd.pause();
        e_snd.currentTime=0;  
    }


}

// Create instances of UI classes for each screen
const game = new Game();
const gameUI = new GameUI(game);

function checkAnswer(input) {
    const playerAnswer = parseInt(input.value);
    const correctAnswer = parseInt(input.dataset.answer);
    const exerciseId = input.dataset.id;

    game.checkAnswer(playerAnswer,exerciseId,correctAnswer);
}



export { game,gameUI };
