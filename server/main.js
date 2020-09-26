require("dotenv").config();
const express = require("express");
const session = require("express-session");
const bodyParser = require("body-parser");
const process = require("process");
const fetch = require("node-fetch");
const { Liquid } = require("liquidjs");
const path = require("path");
const engine = new Liquid();
const sassMiddleware = require("node-sass-middleware");
const db = require("./db/db");


const app = express();
const port = process.env.PORT || 8000;

app.use(session({
    store: new (require("connect-pg-simple")(session))(),
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }, // 30 days
    resave: true,
    saveUninitialized: false,
    secret: process.env.SECRET
}
));
app.use(bodyParser.urlencoded({extended : true}));
app.use(bodyParser.json());

app.engine("html", engine.express()); 
app.set("views", __dirname+"/site");
app.set("view engine", "liquid");

app.use(sassMiddleware({
    /* Options */
    src: __dirname+"/site",
    dest: path.join(__dirname, "site/"),
    outputStyle: "compressed",
    prefix:  ""
}));

app.get("/",(req,res)=>{

    if(req.query.code){
        //Collect access code from request
        const accessCode = req.query.code;
        //Setup data to send to discord
        const data = {
            client_id: process.env.clientID,
            client_secret: process.env.clientSecret,
            grant_type: "authorization_code",
            redirect_uri: process.env.redirect,
            code: accessCode,
            scope: "identity",
        };
        //Send data
        fetch("https://discord.com/api/oauth2/token", {
            method: "POST",
            body: new URLSearchParams(data),
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            }
        })
            .then(res => res.json()) //Convert data to json
            .then(async tokenInfo =>{
                let sessionData = req.session;
                sessionData.user = await fetch("https://discord.com/api/users/@me",{
                    headers: {
                        authorization: `${tokenInfo.token_type} ${tokenInfo.access_token}`,
                    }
                }).then(res=>res.json());
                sessionData.token = tokenInfo;
                sessionData.save();
                return res.redirect("/");
            }); //log data
        return;
    }
    res.render("index.html", {
        user:{
            discord: req.session.user
        },
        login:{
            state: generateRandomString(),
            redirect: encodeURIComponent(process.env.redirect),
            client: process.env.clientID,
        }
    });
});

app.get("/logout",(req,res)=>{
    req.session.destroy();
    res.redirect("/");
});

app.get("/admin",async (req,res)=>{
    if(!req.session.user) return res.redirect("/");
    let user = await db.query(`
        select
            user_id,
            admin
        from users
        where user_id = %L
    `,[req.session?.user.id]).then(res=>res.rows[0]);
    if(!user || !user.admin) return res.redirect("/");

    let boards = await db.query(`
        select 
            board_id as id,
            board_name as name
        from boards
    `).then(res=>res.rows);
    
    res.render("admin.html",{
        user:{
            discord: req.session.user
        },
        boards:boards
    });
});

app.get("/list",async (req,res)=>{

    let boards = await db.query(`
        select 
            board_slug as id,
            board_name as display
        from boards
    `).then(res=>res.rows);

    res.render("list.html", {
        user:{
            discord: req.session.user
        },
        login:{
            state: generateRandomString(),
            redirect: encodeURIComponent(process.env.redirect),
            client: process.env.clientID,
        },
        boards:boards
    });
});

app.get("/vote/:id",async (req,res)=>{
    let board = await db.query(`
        select 
            board_id as id,
            board_slug as slug,
            board_name as name,
            board_description as description,
            board_item_name as itemname,
            board_max_votes as votes
        from boards
        where board_slug = %L;
    `,[req.params.id]).then(res=>res.rows[0]);
    if(!board) return res.sendStatus(404);
    
    let items = await db.query(`
    select
        items.item_id as id,
        item_name as name,
        count(v.item_id) as count
    from items left join votes v using (item_id)
    where items.board_id = %L
    group by items.item_id;
    `,[board.id]).then(res=>res.rows).catch(e=>{console.error(e);return res.sendStatus(500);});
    let votes;
    if(req.session.user) votes = await db.query(`
        select
            item_id
        from votes
        where user_id = %L
    `,[req.session.user.id]).then(res=>res.rows.map(res=>res.item_id)).catch(e=>{console.error(e);return res.sendStatus(500);});

    res.render("vote.html", {
        user:{
            discord: req.session.user,
            votes: votes
        },
        login:{
            state: generateRandomString(),
            redirect: encodeURIComponent(process.env.redirect),
            client: process.env.clientID,
        },
        board:board,
        items:items
    });
});

app.post("/api/vote/:board/:id", async (req,res)=>{
    if(!req.session?.user) res.sendStatus(401);
    else {

        let voteCount = await db.query(`
        select
            count(*),
            b.board_max_votes as max
        from votes v join boards b on v.board_id = b.board_id
        where v.user_id = %L and v.board_id = %L
        group by b.board_max_votes
        `,[req.session.user.id, req.params.board]).then(res=>res.rows[0]);        

        if(!voteCount){
            voteCount = await db.query(`
            select
                0 as count,
                board_max_votes as max
            from boards
            where board_id = %L
            `,[req.params.board]).then(res=>res.rows[0]);
            if(!voteCount) return res.sendStatus(404);
        }
        if(req.body.create){
            if(parseInt(voteCount.count)+1 > voteCount.max) {
                res.status(403);
                return res.send(JSON.stringify({max: voteCount.max}));
            }
            await db.query(
                "INSERT INTO votes (board_id, item_id, user_id) values (%L, %L, %L)",
                [req.params.board, req.params.id, req.session.user.id]
            ).then(()=>{
                res.status(200);
                res.send(JSON.stringify({ create: true }));
            }).catch((e)=>{
                res.sendStatus(500);
                console.error(e);
            });
        }else if(req.body.create === false){
            await db.query(
                "delete from votes where board_id = %L and item_id = %L and user_id = %L",
                [req.params.board, req.params.id, req.session.user.id]
            ).then(()=>{
                res.status(200);
                res.send(JSON.stringify({ create: false }));
            }).catch((e)=>{
                res.sendStatus(500);
                console.error(e);
            });
        }
        
    }
});

app.get("/api/items/:board",async (req,res)=>{
    let items = await db.query(`
    select
        items.item_id as id,
        item_name as name,
        count(v.item_id) as count,
        false as voted
    from items left join votes v on items.item_id = v.item_id
    where items.board_id = %L
    group by items.item_id
    order by "count" desc, item_name asc;
    `,[req.params.board]).then(res=>res.rows).catch(e=>{console.error(e);return res.sendStatus(500);});
    let votes = [];
    if(req.session.user) votes = await db.query(`
        select
            item_id
        from votes
        where user_id = %L
    `,[req.session.user.id]).then(res=>res.rows.map(res=>res.item_id)).catch(e=>{console.error(e);return res.sendStatus(500);});

    for (let i = 0; i < votes.length; i++) {
        const voteId = votes[i];
        items.find(e=>e.id==voteId).voted = true;
    }
    res.status(200);
    res.send(items);
});




app.post("/api/addAdmin",async (req,res)=>{
    if(!req.session.user) return res.sendStatus(401);
    let user = await db.query(`
        select
            user_id,
            admin
        from users
        where user_id = %L
    `,[req.session?.user.id]).then(res=>res.rows[0]);
    if(!user || !user.admin) return res.sendStatus(401);
    try{
        await db.query(`
        insert into users
        (user_id, admin)
        values
        (%L, true)
        `,[req.body.id.trim()]);
    } catch (e){
        console.error(e);
        switch (e.message){
        default: return res.sendStatus(500);
        }
    }
    res.status(200);
    res.redirect("/admin");
});
app.post("/api/addBoard",async (req,res)=>{
    if(!req.session.user) return res.sendStatus(401);
    let user = await db.query(`
        select
            user_id,
            admin
        from users
        where user_id = %L
    `,[req.session?.user.id]).then(res=>res.rows[0]);
    if(!user || !user.admin) return res.sendStatus(401);

    try{
        let board = await db.query(`
        insert into boards
            (board_name, board_slug, board_description, board_item_name, board_max_votes)
        values
            (%L, %L, %L, %L, %L);
    `,[req.body.name.trim(), req.body.slug.trim(), req.body.description.trim() ?? null, req.body.item.trim(), req.body.votes]);
    }catch(e){
        console.error(e.message);
        switch(e.message){
        case "duplicate key value violates unique constraint \"boards_board_slug_key\"": return res.send("Slug in use");
        case "duplicate key value violates unique constraint \"boards_board_name_key\"": return res.send("Name in use");
        default: return res.send(e.message);
        }
    }


    res.status(200);
    res.redirect("/admin");
});
app.post("/api/addItems",async (req,res)=>{
    if(!req.session.user) return res.sendStatus(401);
    let user = await db.query(`
        select
            user_id,
            admin
        from users
        where user_id = %L
    `,[req.session?.user.id]).then(res=>res.rows[0]);
    if(!user || !user.admin) return res.sendStatus(401);
    let items = req.body.items.split("\n");
    items = items.filter(val=>val!="").map(i=>[req.body.board, i.trim()]);
    try{
        let itemsInserted = await db.query(`
            insert into items
                (board_id, item_name)
            values
                %L
            on conflict (board_id,item_name) do nothing;
        `,[items]);
    } catch(e){
        switch(e.message){
        default: return res.sendStatus(500);
        }
    }
    res.status(200);
    res.redirect("/admin");
});


app.post("/api/removeBoard",async (req,res)=>{
    if(!req.session.user) return res.sendStatus(401);
    let user = await db.query(`
        select
            user_id,
            admin
        from users
        where user_id = %L
    `,[req.session?.user.id]).then(res=>res.rows[0]);
    if(!user || !user.admin) return res.sendStatus(401);
    if(req.body.board != req.body.verify.trim()) return res.send("Confirmation failed: Board Name and Text Field do not match");
    try{
        let board = await db.query(`
        delete from boards
        where board_name = %L;
    `,[req.body.board]);
    }catch(e){
        console.error(e.message);
        switch(e.message){
        default: return res.send(e.message);
        }
    }
    res.status(200);
    res.redirect("/admin");

});
app.post("/api/removeItems",async (req,res)=>{
    if(!req.session.user) return res.sendStatus(401);
    let user = await db.query(`
        select
            user_id,
            admin
        from users
        where user_id = %L
    `,[req.session?.user.id]).then(res=>res.rows[0]);
    if(!user || !user.admin) return res.sendStatus(401);
    let items = req.body.items.split("\n");
    items = items.filter(val=>val!="").map(i=>i.trim());
    try{
        await db.query(`
        delete from items
        where board_id = %L and item_name in (%L)
        `,[req.body.board, items]);
    }catch(e){
        console.error(e.message);
        switch(e.message){
        default: return res.send(e.message);
        }
    }


    res.status(200);
    res.redirect("/admin");
});

app.use("/static",express.static(__dirname+"/site/static"));

app.listen(port, ()=>{console.log("Listening on port ",port);});



function generateRandomString() {
    let randStr = Math.random().toString(36).substr(2)+Math.random().toString(36).substr(2);
    return randStr;
}