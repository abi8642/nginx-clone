const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send("Reverse Proxy working fine.");
});

app.get('/admin/*', (req, res) => {
    res.send("Admin Route ok.")
});

app.get('/home', (req, res) => {
    res.send("Home Route ok.")
});

app.post('/', (req, res) => {
    const {name} = req.body;
    res.send(`Hello ${name}`);
});

// Create separate servers for each port
const http = require('http');

// Server on port 8001
http.createServer(app).listen(8001, () => {
    console.log("Server started on port 8001");
});

// Server on port 8002
http.createServer(app).listen(8002, () => {
    console.log("Server started on port 8002");
});

// Server on port 8003
http.createServer(app).listen(8003, () => {
    console.log("Server started on port 8003");
});
