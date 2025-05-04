// gameUI.js
import Game from './game.js';
import Sound from './sounds.js';



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
        this.updateExercisesColor();
        document.getElementById(exerciseId).classList.add('fade-out');
        setTimeout(() => {
            document.getElementById(exerciseId).remove();
        }, 300); // delay for fade-out animation
    }

    setFocus(exerciseId)
    {
        document.getElementById(exerciseId).querySelector("#answer").focus();
    }

    updateScore()
    {
        document.getElementById('score-value').textContent = this.game.score;
    }
    updateLevel()
    {
        document.getElementById('level-value').textContent = this.game.level;
    }
    updateSolved()
    {
        document.getElementById('solved-value').textContent = this.game.solved;
    }

    addExercise(e)  {

        const exerciseId = `exercise-${++this.incId}`;
        const div = document.createElement('div');
        div.className = 'exercise';
        div.id = exerciseId;
        div.innerHTML = `${e.num1} + ${e.num2} = <input id="answer" type="number" class="answer" data-answer="${e.answer}" data-id="${exerciseId}">`;
        this.gameContainer.appendChild(div);
        this.updateExercisesColor();
        return exerciseId;
    }
    updateExercisesColor() {
        var ratio = Math.max(0,this.game.exercises.length-0*this.game.initialExercises) / (this.game.maxExercises-0*this.game.initialExercises) ;
        ratio = 1-(1-ratio)*(1-ratio);
        var val = ratio * (360-197) + 197;
        var color = `hsl(${val}, 58%, 48%)`;
        document.querySelector("#game-container").style.backgroundColor = color;
        // document.querySelectorAll('.exercise').forEach(function(element) {
        //     element.style.backgroundColor = color; // Set to your desired color
        // });
    }
    clearExercise() {
        this.gameContainer.innerHTML="";
        this.updateExercisesColor();
    }

    updateCountDown(count) {
        this.countdown = count;
        this.countdownDisplay.innerHTML = `<span>Level:${this.game.level}<br/>${count.toString()}</span>`; // Update countdown display
    }

    startCountdown(onCountDownFinishFunction) {
        this.updateCountDown(3); // Reset countfade-indown
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
        this.game.init();
        this.startCountdown(this.game.start.bind(this.game));
    }
    playEffect(name)
    {
        var e_effect = document.getElementById("effect");

        var audio = document.getElementById('mp3Effect');
        audio.src = name;
        e_effect.load();

        e_effect.sorce
        e_effect.volume=0.5;
        e_effect.play().catch(error => {});
    
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

    drawDeltaScore(exerciseId, deltascore) {
        var targetElement = document.getElementById(exerciseId);
        const floatingNumber = document.createElement('div');
        floatingNumber.className = 'floatingNumber';
        floatingNumber.innerText = `+${deltascore}`;
        
        // Position the floatingNumber relative to the target element
        const rect = targetElement.getBoundingClientRect();
        floatingNumber.style.left = `${rect.left + rect.width / 2}px`;
        floatingNumber.style.top = `${rect.top}px`;
        
        document.body.appendChild(floatingNumber);
        
        // Animation: Move up and fade out
        setTimeout(() => {
            floatingNumber.style.transform = 'translateY(-30px)'; // Move up
            floatingNumber.style.opacity = '0'; // Fade out
        }, 0);
        
        // Remove the floatingNumber after the animation is complete
        setTimeout(() => {
            document.body.removeChild(floatingNumber);
        }, 500);
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
