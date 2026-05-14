{
  "name": "thulium-ai-agent-backend",
  "version": "0.1.1",
  "description": "Backend AI Agent for Thulium tickets, ready for Render.com",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js",
    "build": "echo \"No build step required\""
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "axios": "^1.7.9",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "express": "^4.21.2",
    "helmet": "^8.0.0",
    "openai": "^4.78.1"
  },
  "devDependencies": {
    "nodemon": "^3.1.9"
  }
}