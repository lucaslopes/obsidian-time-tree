import { MarkdownRenderChild, Plugin, TFile, Notice } from "obsidian";
import { defaultSettings, TimeTreeSettings } from "./settings";
import { TimeTreeSettingsTab } from "./settings-tab";
import {
    displayTracker,
    Entry,
    formatDuration,
    formatTimestamp,
    getDuration,
    getDurationToday,
    getRunningEntry,
    getTotalDuration,
    getTotalDurationToday,
    isRunning,
    loadAllTrackers,
    loadTracker,
    orderedEntries,
} from "./tracker";
import YAML from "yaml";

export default class TimeTreePlugin extends Plugin {
    public api = {
        // verbatim versions of the functions found in tracker.ts with the same parameters
        loadTracker,
        loadAllTrackers,
        getDuration,
        getTotalDuration,
        getDurationToday,
        getTotalDurationToday,
        getRunningEntry,
        isRunning,

        // modified versions of the functions found in tracker.ts, with the number of required arguments reduced
        formatTimestamp: (timestamp: string) =>
            formatTimestamp(timestamp, this.settings),
        formatDuration: (totalTime: number) =>
            formatDuration(totalTime, this.settings),
        orderedEntries: (entries: Entry[]) =>
            orderedEntries(entries, this.settings),
    };
    public settings: TimeTreeSettings;

    async onload(): Promise<void> {
        await this.loadSettings();

        this.addSettingTab(new TimeTreeSettingsTab(this.app, this));

        this.registerMarkdownCodeBlockProcessor("time-tree", (s, e, i) => {
            e.empty();
            let component = new MarkdownRenderChild(e);
            let tracker = loadTracker(s);

            // Wrap file name in a function since it can change
            let filePath = i.sourcePath;
            const getFile = () => filePath;

            // Hook rename events to update the file path
            component.registerEvent(
                this.app.vault.on("rename", (file, oldPath) => {
                    if (file instanceof TFile && oldPath === filePath) {
                        filePath = file.path;
                    }
                })
            );

            displayTracker(
                tracker,
                e,
                getFile,
                () => i.getSectionInfo(e),
                this.settings,
                component
            );
            i.addChild(component);
        });

        this.addCommand({
            id: `insert`,
            name: `Insert Time Tracker`,
            editorCallback: (e, _) => {
                e.replaceSelection("```time-tree\n```\n");
            },
        });

        this.addCommand({
            id: "update-accumulated-time",
            name: "Update Accumulated Time",
            callback: async () => {
                await this.updateActiveFileMetadata();
            },
        });
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign(
            {},
            defaultSettings,
            await this.loadData()
        );
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    async updateActiveFileMetadata(): Promise<void> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice("No active file found.");
            return;
        }

        // Use our own API functions (the plugin itself is the time tracker)
        // Load all trackers for the active file.
        const trackers = await this.api.loadAllTrackers(activeFile.path);
        if (!trackers || trackers.length === 0) {
            new Notice("No time trackers found in this file.");
            return;
        }

        // Sum up the total duration.
        let totalDuration = 0;
        if (this.settings.onlyFirstTracker && trackers.length > 0) {
            totalDuration = this.api.getTotalDuration(
                trackers[0].tracker.entries,
                new Date()
            );
        } else {
            for (const { tracker } of trackers) {
                totalDuration += this.api.getTotalDuration(
                    tracker.entries,
                    new Date()
                );
            }
        }

        // Read the file content and update (or add) YAML frontmatter.
        let content = await this.app.vault.read(activeFile);
        const yamlRegex = /^---\n([\s\S]*?)\n---/;
        let newYamlBlock: string;
        const yamlMatch = content.match(yamlRegex);
        if (yamlMatch) {
            try {
                let frontmatter = YAML.parse(yamlMatch[1]) || {};
                frontmatter.elapsed = totalDuration;
                newYamlBlock = `---\n${YAML.stringify(frontmatter)}---\n`;
            } catch (e) {
                new Notice("Error parsing YAML front matter.");
                console.error(e);
                return;
            }
        } else {
            newYamlBlock = `---\nelapsed: ${totalDuration}\n---\n`;
        }

        let newContent: string;
        if (yamlMatch) {
            newContent = newYamlBlock + content.slice(yamlMatch[0].length);
        } else {
            newContent = newYamlBlock + content;
        }

        await this.app.vault.modify(activeFile, newContent);
        new Notice(`Updated elapsed time: ${totalDuration}`);
    }
}
