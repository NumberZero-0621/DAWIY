import App from "../../App";
import { IDawiyPlugin } from "../IDawiyPlugin";

export default class TestPlugin implements IDawiyPlugin {
    id = "test-subdir-plugin";
    name = "Test Subdir Plugin";
    description = "A plugin to test subdirectory loading.";

    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    public render(container: HTMLElement) {
        container.innerHTML = '<h3>Test Subdir Plugin Loaded!</h3>';
    }
}
