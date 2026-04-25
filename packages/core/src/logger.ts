import Log, { Logger, LogLevel } from "@rbxts/log";
import type { ILogEventSink, LogEvent } from "@rbxts/log/out/Core";
import { MessageTemplateParser, PlainTextMessageTemplateRenderer } from "@rbxts/message-templates";
import { RunService } from "@rbxts/services";

import { iterate } from "./utils/type";

export interface LoggerConfig {
	defaultVersion: string;
	isProduction: boolean;
	logLevel: LogLevel;
}

export const loggerConfig: LoggerConfig = {
	defaultVersion: "0.1.0",
	isProduction: false,
	logLevel: LogLevel.Debugging,
};

export let logLevel: LogLevel = loggerConfig.logLevel;

export function configureLogger(config: Partial<LoggerConfig>): void {
	for (const [key, value] of iterate(config)) {
		loggerConfig[key] = value as never;
	}

	logLevel = loggerConfig.isProduction ? LogLevel.Information : loggerConfig.logLevel;
}

export const fullLogOutputs: Array<Array<[string, string]>> = [];
export const logOutput: Array<[string, string]> = [];

const maxLogOutputSize = 128;

const environment = RunService.IsClient() ? "Client" : "Server";
const stackTraceLevelModule = 5;

class LogEventSFTOutputSink implements ILogEventSink {
	public Emit(message: LogEvent): void {
		const template = new PlainTextMessageTemplateRenderer(
			MessageTemplateParser.GetTokens(message.Template),
		);

		const tag = this.getLogLevelString(message.Level);
		const context = message.SourceContext ?? "Game";
		const messageResult = template.Render(message);
		const fileInfo = this.getFileInformation();

		const formattedMessage = `[${tag}] ${context} (${environment}) - ${messageResult}${fileInfo}`;
		const time = DateTime.fromIsoDate(message.Timestamp)!.FormatLocalTime("HH:mm:ss", "en-us");

		if (logOutput.size() > maxLogOutputSize) {
			fullLogOutputs.push(table.clone(logOutput));
			logOutput.clear();
		}

		logOutput.push([time, formattedMessage]);

		if (message.Level >= LogLevel.Fatal) {
			error(formattedMessage);
		} else if (message.Level >= LogLevel.Warning) {
			warn(formattedMessage);
		} else {
			print(formattedMessage);
		}
	}

	private getLogLevelString(level: LogLevel): string {
		switch (level) {
			case LogLevel.Debugging: {
				return "DEBUG";
			}
			case LogLevel.Error: {
				return "ERROR";
			}
			case LogLevel.Fatal: {
				return "FATAL";
			}
			case LogLevel.Information: {
				return "INFO";
			}
			case LogLevel.Verbose: {
				return "VERBOSE";
			}
			case LogLevel.Warning: {
				return "WARN";
			}
		}
	}

	private getFileInformation(): string {
		if (loggerConfig.logLevel > LogLevel.Verbose) {
			return "";
		}

		const [source] = debug.info(stackTraceLevelModule, "sl");
		const [file, line] = source;
		return ` (${file}:${line})`;
	}
}

export function setupLogger(): void {
	const level = loggerConfig.isProduction ? LogLevel.Information : loggerConfig.logLevel;
	logLevel = level;
	Log.SetLogger(
		Logger.configure()
			.SetMinLogLevel(level)
			.EnrichWithProperty("Version", loggerConfig.defaultVersion)
			.WriteTo(new LogEventSFTOutputSink())
			.Create(),
	);
}
