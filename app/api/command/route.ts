// app/api/command/route.ts

import { NextResponse } from "next/server";
import childProcess from "child_process";
import { promisify } from "util";

const execAsync = promisify(childProcess.exec);

const ALLOWED_COMMANDS = new Set([
  "ping",
  "ping6",
  "host",
  "mtr",
  "mtr6",
  "livemtr",
  "livemtr6",
]);

const COMMAND_OPTIONS: { [key: string]: string } = {
  ping: "-4 -c4 -w15",
  ping6: "-6 -c4 -w15",
  host: "",
  mtr: "-rnz4",
  mtr6: "-rnz6",
  livemtr: "-ln4",
  livemtr6: "-ln6",
};

async function getSystemInfo(ip6: boolean = false) {
  try {
    const hostname = await execAsync("hostname -s");
    const ipInfo = await execAsync("hostname -I");

    return {
      hostname: hostname.stdout.trim(),
      ips: !ip6 ? [ipInfo.stdout.split(" ")[0]] : [ipInfo.stdout.split(" ")[1]],
    };
  } catch (error) {
    console.error("Error getting system info:", error);
    return { hostname: "unknown", ips: [] };
  }
}

export async function POST(req: Request) {
  const { targetHost, command } = await req.json();

  if (!targetHost || !command || !ALLOWED_COMMANDS.has(command)) {
    return new Response("Invalid target host or command", { status: 400 });
  }

  // Handle other commands
  const options = COMMAND_OPTIONS[command as keyof typeof COMMAND_OPTIONS];
  let fullCommand;

  switch (command) {
    case "ping":
      fullCommand = `ping ${options} ${targetHost}`;
      break;
    case "ping6":
      fullCommand = `ping ${options} ${targetHost}`;
      break;
    case "traceroute":
      fullCommand = `traceroute ${options} ${targetHost}`;
      break;
    case "host":
      fullCommand = `host ${targetHost}`;
      break;
    case "mtr":
      fullCommand = `mtr ${options} ${targetHost}`;
      break;
    case "livemtr":
      fullCommand = `mtr ${options} ${targetHost}`;
      break;
    case "livemtr6":
      fullCommand = `mtr ${options} ${targetHost}`;
      break;
    case "mtr6":
      fullCommand = `mtr ${options} ${targetHost}`;
      break;
  }

  if (!fullCommand) {
    return new Response("Invalid command", { status: 400 });
  }

  const sysInfo = command.startsWith("livemtr")
    ? await getSystemInfo("livemtr6" === command)
    : null;

  //console.log(sysInfo?.hostname, sysInfo?.ips);

  const response = new NextResponse(
    new ReadableStream({
      start(controller) {
        try {
          if (command.startsWith("livemtr")) {
            // Send system info first
            controller.enqueue(
              `data: ${JSON.stringify({
                type: "system_info",
                hostname: sysInfo?.hostname,
                ips: sysInfo?.ips,
              })}\n\n`,
            );
          }

          const child = childProcess.spawn(fullCommand, [], { shell: true });

          child.stdout.on("data", (data) => {
            controller.enqueue(
              `data: ${JSON.stringify({ output: data.toString() })}`,
            );
          });

          child.stderr.on("data", (error) => {
            controller.enqueue(
              `data: ${JSON.stringify({ error: error.toString() })}`,
            );
          });

          child.on("close", (code) => {
            if (code !== 0) {
              controller.enqueue(
                `data: ${JSON.stringify({
                  error: `Command exited with code ${code}`,
                })}\n`,
              );
            }
            controller.close();
          });
        } catch (error) {
          console.error("Error running command:", error);
          controller.enqueue(
            `data: ${JSON.stringify({ error: "An error occurred" })}\n`,
          );
          controller.close();
        }
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    },
  );

  return response;
}
