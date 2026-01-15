# Contributing to DAWIY

Thank you for your interest in contributing to DAWIY! This document provides guidelines for setting up your environment and contributing code.

## Getting Started

### Prerequisites

- Node.js (v18+ recommended)
- NPM

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/YourUsername/DAWIY.git
   cd DAWIY
   ```

2. Install dependencies:
   - **Windows**
     - Double-click [`run_dev.cmd`](run_dev.cmd) or run `.\run_dev.cmd` in Terminal.
   - **Mac / Linux**
     - Run `sh run_dev.cmd` or `bash run_dev.cmd` in a shell.

### Running the Development Environment

We use a concurrent script to run both the Client and Server.

- Run `run_dev.cmd`

This will start:

- **Client (Frontend):** [http://localhost:5002](http://localhost:5002)
- **Server (Bank):** [http://localhost:6002](http://localhost:6002) (or configured port)

## Project Structure

- `public/`: The Frontend Application (TypeScript, Pixi.js).
- `bank/`: The Backend Server (Node.js/Express) serving plugins and audio assets.

## Development Standards

### TypeScript

- Use strict typing where possible.
- Interface names should be descriptive.

### Architecture

- **Controllers:** Place business logic in `public/src/Controllers/`.
- **Views:** Place rendering logic in `public/src/Views/`.
- **App.ts:** Do not add heavy logic to `public/src/App.ts`. It is a dependency container.

### Git Conventions

- **Commit Messages:** While there are no strict requirements, we encourage you to be clear and descriptive, for example:
  - `feat: Add new reverb plugin`
  - `fix: Resolve piano roll scrolling issue`
  - `docs: Update README`

## Submitting Pull Requests

1. Fork the repository.
2. Create a new branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes.
4. Push to the branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

## License

By contributing, you agree that your contributions will be licensed under its MIT License.
