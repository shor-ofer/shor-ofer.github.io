import { game  } from './gameUI.js';

const OPTION_EASY=10000;
const OPTION_MEDIUM=6000;
const OPTION_HARD=3000;

class OptionsUI
{
    constructor() {
        this.easyBtn = document.getElementById('options-easy');
        this.mediumBtn = document.getElementById('options-medium');
        this.hardBtn = document.getElementById('options-hard');

        this.btnList = [this.easyBtn,this.mediumBtn,this.hardBtn];
        this.optionList = [OPTION_EASY,OPTION_MEDIUM,OPTION_HARD];

        // Attach event listeners
        for(let i = 0; i < this.btnList.length; i++)
            this.btnList[i].addEventListener('click', () => this.select(i));
    }

    select(value)
    {
        this.setOption(this.optionList[value]);
        for(let i=0;i<this.btnList.length;i++)
        {
            if (i==value)
                this.btnList[i].classList.add('select');
            else
                this.btnList[i].classList.remove('select');
        }
    
    }

    setOption(value)
    {
        game.initialSpawnRate = value;
    }

    // This will be called when game over screen is opened
    onShow() {
        for(let i=0;i<this.optionList.length;i++)
        {
            if (game.initialSpawnRate == this.optionList[i])
            {
                this.select(i);
                break;
            }
        }
    }
}

const optionsUI = new OptionsUI();

export {optionsUI}