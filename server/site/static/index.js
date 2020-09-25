/* eslint-disable no-unused-vars */
async function vote(e){
    let board = document.querySelector(".board");
    var xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/vote/${board.id}/${e.id}`, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(JSON.stringify({create: !e.classList.contains("remove")}));
    xhr.onload = ()=>{
        if(xhr.status >= 400) {
            switch(xhr.status){
            case 403: 
                document.querySelector(".message").textContent = `You can only vote ${JSON.parse(xhr.response).max} time${JSON.parse(xhr.response).max != 1?"s":""} on this board!`;
                break;
            case 401:
                document.querySelector(".message").textContent = "You must be logged in!";
                break;
            default:
                document.querySelector(".message").textContent = "Error";
                break;
            }
            
            document.querySelector(".messageContainer").classList.add("showMessage");
            setTimeout(()=>{
                document.querySelector(".messageContainer").classList.remove("showMessage");
            },3000);
        }
        else {
            loadBoard();
        }
        
    };
}

async function loadBoard(){
    let board = document.querySelector(".board");
    let objects = await fetch("/api/items/"+board.id).then(res=>res.json());

    for (let index = 0; index < objects.length; index++) {
        const item = objects[index];
        let row;
        if(!document.querySelector("#item"+item.id))row = document.createElement("div");
        else row = document.querySelector("#item"+item.id);
        row.id = "item"+item.id;
        row.innerHTML = `<p>${item.name}</p><p>${item.count}</p><p><button onclick="vote(this)" id="${item.id}" class="${item.voted?"remove":""}">${item.voted?"Remove Vote":"Vote"}</button></p>`;
        if(!document.querySelector("#item"+item.id))board.appendChild(row);
    }

}

document.onreadystatechange = () => {
    if (document.readyState === "complete") {
        loadBoard();
    }
};
   