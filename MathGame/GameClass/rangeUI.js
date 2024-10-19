import { game ,gameUI } from './gameUI.js';
import Sound from './sounds.js';

class RangeUI
{
    constructor() {}

    createTable() {
        const table = document.getElementById("multiplicationTable");
        table.innerHTML="";

        for (let i = 1; i <= 10; i++) {
            const row = document.createElement("tr");
            for (let j = 1; j <= 10; j++) {
                const cell = document.createElement("td");
                cell.textContent = i * j;
                cell.dataset.row = i;
                cell.dataset.col = j;
                cell.style.cursor = 'pointer';
                if (i==1 || j==1)
                  cell.classList.add("c1i");
                else
                  cell.classList.add("c1");

                // Add click event listener
                cell.addEventListener('click', ()=> {
                    gameUI.playEffect(Sound.SUCCESS);
                    this.colorCells(i, j);
                    game.maxi=i;
                    game.maxj=j;
                });

                row.appendChild(cell);
            }
            table.appendChild(row);
        }
    }    


    colorCells(row, col) {
        const cells = document.querySelectorAll("td");

        cells.forEach(cell => {
            const cellRow = parseInt(cell.dataset.row);
            const cellCol = parseInt(cell.dataset.col);

            // Check if the cell is within the (1,1) to (row,col) range
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
}

const rangeUI = new RangeUI();

export { rangeUI };