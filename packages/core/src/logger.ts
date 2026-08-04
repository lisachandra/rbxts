import Log, { Logger, LogLevel } from "@rbxts/log";
import type { ILogEventSink, LogEvent } from "@rbxts/log/Core";
import { MessageTemplateParser, PlainTextMessageTemplateRenderer } from "@rbxts/message-templates";
import { RunService } from "@rbxts/services";

import { iterate } from "./utils/type";

/**
 * Configuration options for the logging system.
 *
 * @remarks
 *   Controls the log level, production mode, and version tracking for the application's logging
 *   infrastructure.
 */
export interface LoggerConfig {
	defaultVersion: string;
	isProduction: boolean;
	logLevel: LogLevel;
}

/**
 * The default logger configuration.
 *
 * @remarks
 *   Initialized with debugging log level in non-production mode with version `"0.1.0"`. This
 *   configuration can be modified at runtime using {@link configureLogger}.
 */
export const loggerConfig: LoggerConfig = {
	defaultVersion: "0.1.0",
	isProduction: false,
	logLevel: LogLevel.Debugging,
};

/**
 * The current active log level.
 *
 * @remarks
 *   This value is derived from {@link loggerConfig} and is updated automatically when
 *   {@link configureLogger} is called.
 */
// oxlint-disable-next-line import/no-mutable-exports -- log level is reconfigured at runtime
export let { logLevel } = loggerConfig;

/**
 * Applies partial configuration updates to the logger.
 *
 * @remarks
 *   After updating the configuration, the log level is recalculated: if `isProduction` is `true`,
 *   the log level is forced to `Information`; otherwise, the explicitly set `logLevel` is used.
 * @example
 * 	```ts
 * 	configureLogger({ isProduction: true });
 * 	configureLogger({ logLevel: LogLevel.Verbose });
 * 	```;
 *
 * @param config - A partial {@link LoggerConfig} object containing the settings to override.
 */
export function configureLogger(config: Partial<LoggerConfig>): void {
	for (const [key, value] of iterate(config)) {
		loggerConfig[key] = value as never;
	}

	logLevel = loggerConfig.isProduction ? LogLevel.Information : loggerConfig.logLevel;
}

/**
 * Stores historical log output batches when the primary buffer overflows.
 *
 * @remarks
 *   When {@link logOutput} exceeds the maximum size (128 entries), its contents are cloned and
 *   pushed into this array before being cleared. This prevents unbounded memory growth while
 *   preserving log history.
 */
export const fullLogOutputs: Array<Array<[string, string]>> = [];
/**
 * The current in-memory log output buffer.
 *
 * @remarks
 *   Each entry is a tuple of `[timestamp, formattedMessage]`. When this buffer exceeds 128 entries,
 *   it is flushed to {@link fullLogOutputs} and cleared.
 */
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

/**
 * Initializes the logging system and sets up the log event sink.
 *
 * @remarks
 *   Configures the global {@link Log} instance with the current {@link loggerConfig}, enriching log
 *   events with the version property and writing output through the `LogEventSFTOutputSink`.
 * @example
 * 	```ts
 * 	configureLogger({ isProduction: false, logLevel: LogLevel.Debugging });
 * 	setupLogger();
 * 	```;
 */
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
