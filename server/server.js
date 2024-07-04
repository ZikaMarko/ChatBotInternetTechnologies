﻿const express = require("express");
const path = require('path');
const https = require("https");
const { join } = require("path");
const socketIo = require("socket.io");
const fs = require("fs");
const {promisify} = require("util");

let certificates;
try {
    certificates = {
        key: fs.readFileSync(path.join(__dirname, 'ssl/key.pem')),
        cert: fs.readFileSync(path.join(__dirname, 'ssl/cert.pem'))
    };
    console.log("SSL certificates loaded successfully.");
} catch (err) {
    console.error("Error loading SSL certificates:", err);
    process.exit(1);
}

const PORT = process.env.PORT || 3001;
const app = express();
const server = https.createServer(certificates, app);
const io = socketIo(server);

app.use(express.static(join(__dirname, '../client/build')));

/*
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/public/build/index.html'));
});
*/

const filePath = 'server/responses.json';
let responses = {};

const readFileAsync = promisify(fs.readFile);


(async () => {
    try {
        const data = await readFileAsync(filePath, 'utf8');
        responses = JSON.parse(data);
        console.log("Responses loaded successfully")
        //console.log("Responses loaded successfully: ", responses);
    } catch (err) {
        console.error('Error reading or parsing JSON:', err);
    }
})();

const userStates = {};

io.on("connection", (socket) => {
    console.log("New client connected");
    userStates[socket.id] = { counter: 0 }; // Initialize counter in user state

    socket.emit("receiveMessage", { response: responses.default });

    socket.on("sendMessage", (message) => {
        let response;
        const lowerMessage = message.toLowerCase();

        if (!userStates[socket.id].context) {
            userStates[socket.id].context = "begin";
        }

        const findResponse = (keywords, context) => {
            for (let phrase in keywords[context]) {
                const regex = new RegExp(`\\b${phrase}\\b`, 'i');
                if (regex.test(lowerMessage)) {
                    return keywords[context][phrase];
                }
            }
            return null;
        };

        function hardFallBack() {
            userStates[socket.id].counter += 1; // Increment counter
            console.log(userStates[socket.id].counter);
            if (userStates[socket.id].counter >= 4) {
                console.log("Hard Fall Back");
                // Send hard fallback response and reset the counter
                // response = "It seems like we're having trouble understanding each other. Please try rephrasing your question.";
                // userStates[socket.id].counter = 0; // Reset counter
            }
        }

        // Check context-specific responses first
        let responseData = findResponse(responses, userStates[socket.id].context);

        if (userStates[socket.id].context === "restart") {
            responseData = findResponse(responses, "restart");
        } else if (!responseData) {
            // Check basic keywords if context-specific response not found
            responseData = findResponse(responses, 'basic_keywords');
        }

        if (!responseData) {
            // Use default response in the current context if no match found
            if (responses[userStates[socket.id].context] && responses[userStates[socket.id].context].default) {
                responseData = responses[userStates[socket.id].context].default;
                hardFallBack();
            }
        }

        if (responseData) {
            if (typeof responseData === "string") {
                response = responseData; // Handle simple string response
            } else if (typeof responseData === "object" && responseData.answer) {
                response = responseData.answer; // Handle structured response with "answer"

                // Update context based on "switch" field in the response
                if (responseData.switch) {
                    userStates[socket.id].context = responseData.switch;
                }
            }
        } else {
            // Fallback response if no specific or default response found
            response = "I'm sorry, I didn't understand that.";
            hardFallBack(); // Call hard fallback function
        }

        socket.emit("receiveMessage", { message, response });
        console.log(userStates[socket.id].context);
        if (userStates[socket.id].counter === 4) {
            io.to(socket.id).emit('refresh page');
            userStates[socket.id].counter = 0;
        }

    });

    socket.on("disconnect", () => {
        console.log("Client disconnected");
        delete userStates[socket.id]; // Clean up user state on disconnect
    });
});

server.listen(PORT, () => {
    console.log(`Server listening on https://localhost:${PORT}`);
});
