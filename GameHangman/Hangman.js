var app;
var old_letters_guessed=[];
var secret_word="";


function  show_hidden_word()
{
    var final_string="";
    for(i=0;i<secret_word.length;i++)
    {
        if (old_letters_guessed[secret_word[i]]==undefined)
           final_string+="_";
        else
           final_string+=secret_word[i]+"";

    }


    $("#word").text(final_string);
}

function updatechar(event)
{
    var myc = event.target.attributes.chr.value;//String.fromCharCode(event.target.attributes.chr.value+97);
    old_letters_guessed[myc]=true;
    

    newpos=[Math.random()*3-1.5,Math.random()*3+1];
    head.position = newpos;

    var found=false;
    if (secret_word.indexOf(myc)>=0)
        event.target.classList.add("selectedgood");
    else
        event.target.classList.add("selectedbad");
    show_hidden_word();


}

function initLetters()
{
    s="";
    for(var i=0;i<26;i++)
       s=s+"<div class='letter' chr='"+String.fromCharCode(i+97)+"' onclick='updatechar(event)'>"+String.fromCharCode(i+97) + "</div>"
    $("#letters").html(s);

}
 
function InitGame(gamearea)
{


    
    

    //old_letters_guessed["o"]=true;
    //old_letters_guessed["l"]=true;

    old_letters_guessed=[];
    secret_word="";
    initLetters();

    

    var url = "Word.js";
		$.getJSON(url, function(jd) {
            index = parseInt(Math.random()*jd.length);
			secret_word = jd[index]
            //secret_word="ofer"

            show_hidden_word();
            app = createApp(gamearea);
		});

    
}









