import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * RouteCraft demo API written with only the Java standard library.
 *
 * Compile and run:
 *   javac -d demos/java/bin demos/java/RouteCraftJavaDemo.java
 *   java -cp demos/java/bin RouteCraftJavaDemo 8011
 *
 * Open:
 *   http://127.0.0.1:8011/docs
 *   http://127.0.0.1:8011/openapi.json
 */
public final class RouteCraftJavaDemo {
    private static final class ResponseSent extends RuntimeException {
        ResponseSent() {
            super(null, null, false, false);
        }
    }

    private static final int[] CODES = {200, 201, 202, 204, 301, 400, 401, 403, 404, 409, 418, 422, 429, 500, 502, 503};
    private static final Instant STARTED = Instant.now();
    private static final AtomicInteger NEXT_ID = new AtomicInteger(3);
    private static final List<String> ITEMS = new ArrayList<>(List.of(
            "{\"id\":1,\"name\":\"Java coffee\",\"price\":7.25,\"status\":\"available\"}",
            "{\"id\":2,\"name\":\"Spring sticker\",\"price\":1.5,\"status\":\"available\"}"
    ));

    private final int port;

    private RouteCraftJavaDemo(int port) {
        this.port = port;
    }

    public static void main(String[] args) throws Exception {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 8011;
        RouteCraftJavaDemo app = new RouteCraftJavaDemo(port);
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        server.createContext("/", app::handle);
        server.setExecutor(Executors.newFixedThreadPool(8));
        server.start();
        System.out.println("Java demo API listening on http://127.0.0.1:" + port);
        System.out.println("Docs: http://127.0.0.1:" + port + "/docs");
        System.out.println("OpenAPI: http://127.0.0.1:" + port + "/openapi.json");
    }

    private void handle(HttpExchange exchange) throws IOException {
        addCors(exchange.getResponseHeaders());
        try {
            if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(204, -1);
                return;
            }
            String path = exchange.getRequestURI().getPath();
            String method = exchange.getRequestMethod().toUpperCase(Locale.ROOT);

            if (path.equals("/")) {
                requireMethod(exchange, "GET");
                sendJson(exchange, 200, healthJson());
            } else if (path.equals("/rc")) {
                requireMethod(exchange, "GET");
                exchange.getResponseHeaders().set("Location", "/docs?rc=1");
                exchange.sendResponseHeaders(302, -1);
            } else if (path.equals("/docs")) {
                requireMethod(exchange, "GET");
                sendHtml(exchange, 200, docsHtml());
            } else if (path.equals("/openapi.json")) {
                requireMethod(exchange, "GET");
                sendJson(exchange, 200, openApiJson());
            } else if (path.equals("/codes")) {
                requireMethod(exchange, "GET");
                sendJson(exchange, 200, codesJson());
            } else if (path.startsWith("/status/")) {
                requireMethod(exchange, "GET");
                statusEndpoint(exchange, path);
            } else if (path.equals("/items")) {
                if (method.equals("GET")) {
                    sendJson(exchange, 200, itemsJson());
                } else if (method.equals("POST")) {
                    createItem(exchange);
                } else {
                    methodNotAllowed(exchange, "GET, POST");
                }
            } else if (path.equals("/secure")) {
                requireMethod(exchange, "GET");
                secureEndpoint(exchange);
            } else if (path.equals("/echo")) {
                requireMethod(exchange, "POST");
                echoEndpoint(exchange);
            } else {
                sendJson(exchange, 404, "{\"status\":404,\"message\":\"Route not found\",\"path\":" + quote(path) + "}");
            }
        } catch (ResponseSent ignored) {
            // The 405 response has already been written.
        } catch (Exception error) {
            try {
                sendJson(exchange, 500, "{\"status\":500,\"message\":" + quote(String.valueOf(error.getMessage())) + "}");
            } catch (Exception ignored) {
                // The exchange is already closed.
            }
        } finally {
            exchange.close();
        }
    }

    private void statusEndpoint(HttpExchange exchange, String path) throws IOException {
        String raw = path.substring("/status/".length());
        int code;
        try {
            code = Integer.parseInt(raw);
        } catch (NumberFormatException error) {
            sendJson(exchange, 400, "{\"status\":400,\"message\":\"Use /status/<number>.\"}");
            return;
        }
        if (code < 200 || code > 599) {
            sendJson(exchange, 400, "{\"status\":400,\"message\":\"Use a status code between 200 and 599.\"}");
            return;
        }
        if (code == 204 || code == 304) {
            exchange.sendResponseHeaders(code, -1);
            return;
        }
        String body = "{\"status\":" + code
                + ",\"message\":\"This is a " + code + " response from Java.\""
                + ",\"server\":\"java:" + port + "\""
                + ",\"request_id\":" + quote(requestId(exchange))
                + ",\"method\":" + quote(exchange.getRequestMethod())
                + ",\"path\":" + quote(path) + "}";
        sendJson(exchange, code, body);
    }

    private void createItem(HttpExchange exchange) throws IOException {
        String body = readBody(exchange);
        String name = jsonString(body, "name");
        if (name == null || name.isBlank()) {
            sendJson(exchange, 422, "{\"status\":422,\"message\":\"name is required.\"}");
            return;
        }
        String priceText = jsonNumber(body, "price");
        double price = 0;
        try {
            price = priceText == null ? 0 : Double.parseDouble(priceText);
        } catch (NumberFormatException ignored) {
            price = 0;
        }
        int id = NEXT_ID.getAndIncrement();
        String item = "{\"id\":" + id + ",\"name\":" + quote(name.trim()) + ",\"price\":" + price + ",\"status\":\"available\"}";
        synchronized (ITEMS) {
            ITEMS.add(item);
        }
        sendJson(exchange, 201, item);
    }

    private void secureEndpoint(HttpExchange exchange) throws IOException {
        String auth = exchange.getRequestHeaders().getFirst("Authorization");
        if (!"Bearer demo-token".equals(auth)) {
            sendJson(exchange, 401, "{\"status\":401,\"message\":\"Send Authorization: Bearer demo-token.\"}");
            return;
        }
        sendJson(exchange, 200, "{\"ok\":true,\"user\":\"demo\",\"server\":\"java:" + port + "\",\"scopes\":[\"items:read\",\"items:write\"]}");
    }

    private void echoEndpoint(HttpExchange exchange) throws IOException {
        String body = readBody(exchange);
        StringBuilder headers = new StringBuilder("{");
        Headers requestHeaders = exchange.getRequestHeaders();
        boolean first = true;
        for (String key : requestHeaders.keySet()) {
            if (!first) headers.append(',');
            first = false;
            headers.append(quote(key)).append(':').append(quote(String.join(",", requestHeaders.get(key))));
        }
        headers.append('}');
        String query = exchange.getRequestURI().getRawQuery();
        sendJson(exchange, 200, "{\"method\":\"POST\",\"body\":" + quote(body) + ",\"headers\":" + headers
                + ",\"query\":" + quote(query == null ? "" : query) + "}");
    }

    private String healthJson() {
        return "{\"status\":\"healthy\",\"service\":\"Java Status Codes Demo\",\"port\":" + port
                + ",\"codes\":\"/codes\",\"docs\":\"/docs\",\"openapi\":\"/openapi.json\""
                + ",\"started_at\":" + quote(STARTED.toString()) + "}";
    }

    private String codesJson() {
        StringBuilder codes = new StringBuilder("[");
        for (int i = 0; i < CODES.length; i++) {
            if (i > 0) codes.append(',');
            codes.append(CODES[i]);
        }
        codes.append(']');
        return "{\"codes\":" + codes + ",\"hint\":\"GET /status/<code> returns that status code.\"}";
    }

    private String itemsJson() {
        synchronized (ITEMS) {
            return "[" + String.join(",", ITEMS) + "]";
        }
    }

    private static void requireMethod(HttpExchange exchange, String method) throws IOException {
        if (!method.equalsIgnoreCase(exchange.getRequestMethod())) {
            methodNotAllowed(exchange, method);
            throw new ResponseSent();
        }
    }

    private static void methodNotAllowed(HttpExchange exchange, String allowed) throws IOException {
        exchange.getResponseHeaders().set("Allow", allowed);
        sendJson(exchange, 405, "{\"status\":405,\"message\":\"Use " + allowed + " for this route.\"}");
    }

    private static void addCors(Headers headers) {
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        headers.set("Access-Control-Allow-Headers", "*");
        headers.set("Access-Control-Expose-Headers", "X-Request-Id, X-Demo-Server");
        headers.set("X-Demo-Server", "java:8011");
    }

    private static String requestId(HttpExchange exchange) {
        String supplied = exchange.getRequestHeaders().getFirst("X-Request-Id");
        return supplied == null || supplied.isBlank()
                ? "java-" + System.currentTimeMillis()
                : supplied;
    }

    private static String readBody(HttpExchange exchange) throws IOException {
        try (InputStream input = exchange.getRequestBody(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            input.transferTo(output);
            return output.toString(StandardCharsets.UTF_8);
        }
    }

    private static String jsonString(String body, String key) {
        java.util.regex.Matcher matcher = java.util.regex.Pattern
                .compile("\"" + java.util.regex.Pattern.quote(key) + "\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"")
                .matcher(body);
        return matcher.find() ? unescape(matcher.group(1)) : null;
    }

    private static String jsonNumber(String body, String key) {
        java.util.regex.Matcher matcher = java.util.regex.Pattern
                .compile("\"" + java.util.regex.Pattern.quote(key) + "\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)")
                .matcher(body);
        return matcher.find() ? matcher.group(1) : null;
    }

    private static String unescape(String value) {
        return value.replace("\\\"", "\"").replace("\\\\", "\\").replace("\\n", "\n").replace("\\t", "\t");
    }

    private static String quote(String value) {
        if (value == null) return "null";
        StringBuilder out = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (c < 0x20) out.append(String.format("\\u%04x", (int) c));
                    else out.append(c);
                }
            }
        }
        return out.append('"').toString();
    }

    private static void sendJson(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    private static void sendHtml(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "text/html; charset=utf-8");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    private String docsHtml() {
        StringBuilder chips = new StringBuilder();
        for (int code : CODES) {
            chips.append("<a class=\"code\" href=\"/status/").append(code).append("\" target=\"_blank\">")
                    .append(code).append("</a>");
        }
        return """
                <!doctype html>
                <html lang="en">
                <head>
                  <meta charset="utf-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1">
                  <title>Java Status Codes Demo</title>
                  <style>
                    body { margin: 0; padding: 48px 24px; font: 15px/1.6 system-ui, sans-serif; color: #18212c; background: #f6f8fa; }
                    main { max-width: 760px; margin: 0 auto; }
                    h1 { font-size: 34px; letter-spacing: -.03em; margin: 0 0 8px; }
                    p { color: #586474; }
                    .links { display: flex; gap: 8px; flex-wrap: wrap; margin: 20px 0 28px; }
                    a { color: #2563eb; }
                    .code { display: inline-block; padding: 7px 12px; border: 1px solid #cbd4df; border-radius: 8px; background: #fff; text-decoration: none; font-weight: 650; }
                    .code:hover { border-color: #2563eb; }
                    code { background: #e9edf2; padding: 2px 6px; border-radius: 5px; }
                    .hint { border-left: 3px solid #2563eb; padding: 8px 14px; background: #e8efff; border-radius: 0 6px 6px 0; }
                  </style>
                </head>
                <body>
                  <main>
                    <h1>Java Status Codes Demo</h1>
                    <p>Use this page with the RouteCraft userscript or extension to verify every response path.</p>
                    <div class="links">
                      <a href="/openapi.json">OpenAPI JSON</a>
                      <a href="/docs">This page</a>
                      <a href="/codes">Code list</a>
                      <a href="/secure">Protected endpoint</a>
                    </div>
                    <p class="hint">Click the RouteCraft launcher, then open the auto-detected spec. Try <code>GET /status/418</code> and <code>GET /status/503</code>.</p>
                    <h2>Status endpoints</h2>
                    <div class="links">%s</div>
                  </main>
                </body>
                </html>
                """.formatted(chips);
    }

    private String openApiJson() {
        String spec = """
                {
                  "openapi": "3.0.3",
                  "info": {
                    "title": "Java Status Codes Demo",
                    "description": "A small Java standard-library service for verifying RouteCraft. Every status code endpoint returns the code you asked for.",
                    "version": "1.0.0"
                  },
                  "servers": [{ "url": "http://127.0.0.1:__PORT__" }],
                  "tags": [
                    { "name": "health" },
                    { "name": "status codes" },
                    { "name": "items" },
                    { "name": "auth" },
                    { "name": "echo" }
                  ],
                  "paths": {
                    "/": {
                      "get": {
                        "tags": ["health"],
                        "summary": "Health check",
                        "responses": { "200": { "description": "OK" } }
                      }
                    },
                    "/codes": {
                      "get": {
                        "tags": ["status codes"],
                        "summary": "List testable status codes",
                        "responses": { "200": { "description": "OK" } }
                      }
                    },
                    "/status/{code}": {
                      "get": {
                        "tags": ["status codes"],
                        "summary": "Return a specific HTTP status code",
                        "parameters": [
                          { "name": "code", "in": "path", "required": true, "schema": { "type": "integer", "minimum": 200, "maximum": 599 } }
                        ],
                        "responses": {
                          "200": { "description": "The requested status code" },
                          "400": { "description": "Invalid status code" }
                        }
                      }
                    },
                    "/items": {
                      "get": {
                        "tags": ["items"],
                        "summary": "List demo items",
                        "responses": {
                          "200": {
                            "description": "OK",
                            "content": { "application/json": { "schema": { "type": "array", "items": { "$ref": "#/components/schemas/Item" } } } }
                          }
                        }
                      },
                      "post": {
                        "tags": ["items"],
                        "summary": "Create a demo item",
                        "requestBody": {
                          "required": true,
                          "content": { "application/json": { "schema": { "$ref": "#/components/schemas/ItemInput" } } }
                        },
                        "responses": {
                          "201": {
                            "description": "Created",
                            "content": { "application/json": { "schema": { "$ref": "#/components/schemas/Item" } } }
                          },
                          "422": { "description": "Validation error" }
                        }
                      }
                    },
                    "/secure": {
                      "get": {
                        "tags": ["auth"],
                        "summary": "Bearer-protected endpoint",
                        "security": [{ "bearerAuth": [] }],
                        "responses": {
                          "200": { "description": "Authenticated" },
                          "401": { "description": "Missing or invalid token" }
                        }
                      }
                    },
                    "/echo": {
                      "post": {
                        "tags": ["echo"],
                        "summary": "Echo a JSON body",
                        "requestBody": {
                          "content": { "application/json": { "schema": { "type": "object", "additionalProperties": true } } }
                        },
                        "responses": { "200": { "description": "OK" } }
                      }
                    }
                  },
                  "components": {
                    "securitySchemes": {
                      "bearerAuth": { "type": "http", "scheme": "bearer" }
                    },
                    "schemas": {
                      "Item": {
                        "type": "object",
                        "required": ["id", "name", "price", "status"],
                        "properties": {
                          "id": { "type": "integer" },
                          "name": { "type": "string" },
                          "price": { "type": "number", "format": "double" },
                          "status": { "type": "string", "enum": ["available", "sold-out"] }
                        }
                      },
                      "ItemInput": {
                        "type": "object",
                        "required": ["name"],
                        "properties": {
                          "name": { "type": "string" },
                          "price": { "type": "number", "format": "double" }
                        }
                      }
                    }
                  }
                }
                """;
        return spec.replace("__PORT__", String.valueOf(port));
    }
}

