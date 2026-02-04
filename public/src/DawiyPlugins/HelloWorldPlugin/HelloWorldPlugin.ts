import App from "../../App";
import { DAWIYPlugin } from "../IDawiyPlugin";
import DawiyPluginBase from "../DawiyPluginBase";

@DAWIYPlugin
export default class HelloWorldPlugin extends DawiyPluginBase {
    id = "hello-world-logger";
    name = "Hello World Logger";
    description = "A simple plugin that logs 'Hello World' to the console when activated.";

    constructor(app: App) {
        super(app);
    }

    public override render(container: HTMLElement) {
        // Clear previous content
        container.innerHTML = '';

        const title = document.createElement('h3');
        title.textContent = 'Hello World Plugin';
        container.appendChild(title);

        const descriptionParagraph = document.createElement('p');
        descriptionParagraph.textContent = 'Click the button below to log "Hello World" to the browser console.';
        container.appendChild(descriptionParagraph);

        const logButton = document.createElement('button');
        logButton.textContent = 'Log "Hello World"';
        logButton.style.padding = '10px 15px';
        logButton.style.backgroundColor = '#4CAF50';
        logButton.style.color = 'white';
        logButton.style.border = 'none';
        logButton.style.borderRadius = '5px';
        logButton.style.cursor = 'pointer';
        logButton.style.marginTop = '10px';

        logButton.addEventListener('click', () => {
            console.log("Hello World from DAWIY Plugin!");
            // Optionally, provide visual feedback
            alert("Logged 'Hello World' to console! Check your browser's developer tools.");
        });

        container.appendChild(logButton);
    }
}