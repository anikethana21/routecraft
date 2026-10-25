import type { CodeRequest } from '../types';

export const CODE_LANGUAGES = [
  { id: 'curl', label: 'cURL' },
  { id: 'fetch', label: 'JavaScript' },
  { id: 'axios', label: 'Axios' },
  { id: 'python', label: 'Python' },
  { id: 'go', label: 'Go' },
  { id: 'php', label: 'PHP' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'java', label: 'Java' },
  { id: 'csharp', label: 'C#' },
  { id: 'httpie', label: 'HTTPie' },
  { id: 'powershell', label: 'PowerShell' },
] as const;

export type CodeLanguage = (typeof CODE_LANGUAGES)[number]['id'];

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function phpQuote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function javaQuote(value: string): string {
  return JSON.stringify(value);
}

function pyLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'None';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(pyLiteral).join(', ')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${JSON.stringify(key)}: ${pyLiteral(item)}`)
      .join(', ')}}`;
  }
  return 'None';
}

function bodyIsJson(request: CodeRequest): boolean {
  if (!request.body) return false;
  const type = Object.entries(request.headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1] || '';
  if (/json/i.test(type)) return true;
  try {
    JSON.parse(request.body);
    return true;
  } catch {
    return false;
  }
}

function parsedBody(request: CodeRequest): unknown {
  if (!request.body) return null;
  try {
    return JSON.parse(request.body);
  } catch {
    return request.body;
  }
}

function pythonLiteralBody(request: CodeRequest): string {
  const parsed = parsedBody(request);
  return typeof parsed === 'string' ? pyLiteral(parsed) : pyLiteral(parsed);
}

function headersObject(request: CodeRequest): Record<string, string> {
  return request.headers || {};
}

function curl(request: CodeRequest): string {
  const lines = [
    `curl --request ${request.method.toUpperCase()} \\`,
    `  --url ${shellQuote(request.url)}`,
  ];
  for (const [key, value] of Object.entries(headersObject(request))) {
    lines[lines.length - 1] += ' \\';
    lines.push(`  --header ${shellQuote(`${key}: ${value}`)}`);
  }
  if (request.body) {
    lines[lines.length - 1] += ' \\';
    lines.push(`  --data-raw ${shellQuote(request.body)}`);
  }
  return lines.join('\n');
}

function fetchSnippet(request: CodeRequest): string {
  const options: Record<string, unknown> = {
    method: request.method.toUpperCase(),
  };
  if (Object.keys(headersObject(request)).length) options.headers = headersObject(request);
  if (request.body) {
    options.body = bodyIsJson(request) ? JSON.stringify(parsedBody(request), null, 2) : request.body;
  }
  const bodyLiteral =
    request.body && bodyIsJson(request)
      ? `JSON.stringify(${JSON.stringify(parsedBody(request), null, 2)})`
      : request.body
        ? JSON.stringify(request.body)
        : null;
  const shownOptions = { ...options } as Record<string, unknown>;
  if (bodyLiteral) shownOptions.body = '__BODY__';
  let rendered = JSON.stringify(shownOptions, null, 2);
  if (bodyLiteral) rendered = rendered.replace('"__BODY__"', bodyLiteral);
  return `const response = await fetch(${JSON.stringify(request.url)}, ${rendered});

const data = await response.json();
console.log(data);`;
}

function axios(request: CodeRequest): string {
  const options: Record<string, unknown> = {
    method: request.method.toLowerCase(),
    url: request.url,
  };
  if (Object.keys(headersObject(request)).length) options.headers = headersObject(request);
  if (request.body) options.data = bodyIsJson(request) ? parsedBody(request) : request.body;
  return `import axios from "axios";

const response = await axios.request(${JSON.stringify(options, null, 2)});

console.log(response.data);`;
}

function python(request: CodeRequest): string {
  const headers = headersObject(request);
  const lines = [
    'import requests',
    '',
    `url = ${JSON.stringify(request.url)}`,
    `headers = ${pyLiteral(headers)}`,
  ];
  if (request.body) {
    lines.push(`payload = ${pythonLiteralBody(request)}`);
    lines.push('');
    if (bodyIsJson(request)) {
      lines.push(`response = requests.request(${JSON.stringify(request.method.toUpperCase())}, url, headers=headers, json=payload)`);
    } else {
      lines.push(`response = requests.request(${JSON.stringify(request.method.toUpperCase())}, url, headers=headers, data=payload)`);
    }
  } else {
    lines.push('');
    lines.push(`response = requests.request(${JSON.stringify(request.method.toUpperCase())}, url, headers=headers)`);
  }
  lines.push('');
  lines.push('print(response.status_code)');
  lines.push('try:');
  lines.push('    print(response.json())');
  lines.push('except ValueError:');
  lines.push('    print(response.text)');
  return lines.join('\n');
}

function go(request: CodeRequest): string {
  const hasBody = Boolean(request.body);
  const bodyLine = hasBody
    ? `\tpayload := strings.NewReader(${JSON.stringify(request.body)})\n\treq, err := http.NewRequest(${JSON.stringify(request.method.toUpperCase())}, url, payload)`
    : `\treq, err := http.NewRequest(${JSON.stringify(request.method.toUpperCase())}, url, nil)`;
  const headerLines = Object.entries(headersObject(request))
    .map(([key, value]) => `\treq.Header.Set(${JSON.stringify(key)}, ${JSON.stringify(value)})`)
    .join('\n');
  return `package main

import (
\t"fmt"
\t"io"
\t"net/http"${hasBody ? '\n\t"strings"' : ''}
)

func main() {
\turl := ${JSON.stringify(request.url)}
${bodyLine}
\tif err != nil {
\t\tpanic(err)
\t}
${headerLines ? `${headerLines}\n` : ''}
\tres, err := http.DefaultClient.Do(req)
\tif err != nil {
\t\tpanic(err)
\t}
\tdefer res.Body.Close()

\tbody, _ := io.ReadAll(res.Body)
\tfmt.Println(res.Status)
\tfmt.Println(string(body))
}`;
}

function php(request: CodeRequest): string {
  const headers = Object.entries(headersObject(request))
    .map(([key, value]) => `        ${phpQuote(`${key}: ${value}`)}`)
    .join(',\n');
  return `<?php

$curl = curl_init();

curl_setopt_array($curl, [
    CURLOPT_URL => ${phpQuote(request.url)},
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST => ${phpQuote(request.method.toUpperCase())},
    CURLOPT_HTTPHEADER => [
${headers}
    ],${request.body ? `\n    CURLOPT_POSTFIELDS => ${phpQuote(request.body)},` : ''}
]);

$response = curl_exec($curl);
$status = curl_getinfo($curl, CURLINFO_HTTP_CODE);
curl_close($curl);

echo $status . PHP_EOL;
echo $response . PHP_EOL;`;
}

function ruby(request: CodeRequest): string {
  const method = request.method.toUpperCase();
  const classMap: Record<string, string> = {
    GET: 'Get',
    POST: 'Post',
    PUT: 'Put',
    PATCH: 'Patch',
    DELETE: 'Delete',
    HEAD: 'Head',
    OPTIONS: 'Options',
  };
  const klass = classMap[method] || 'Get';
  const headerLines = Object.entries(headersObject(request))
    .map(([key, value]) => `request[${JSON.stringify(key)}] = ${JSON.stringify(value)}`)
    .join('\n');
  return `require 'net/http'
require 'json'

uri = URI(${JSON.stringify(request.url)})
request = Net::HTTP::${klass}.new(uri)
${headerLines}${request.body ? `\nrequest.body = ${JSON.stringify(request.body)}` : ''}

response = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == 'https') do |http|
  http.request(request)
end

puts response.code
puts response.body`;
}

function java(request: CodeRequest): string {
  const headerLines = Object.entries(headersObject(request))
    .map(([key, value]) => `.addHeader(${javaQuote(key)}, ${javaQuote(value)})`)
    .join('\n                ');
  const contentType = Object.entries(headersObject(request)).find(([key]) => key.toLowerCase() === 'content-type')?.[1] || 'application/json';
  const body = request.body
    ? `RequestBody body = RequestBody.create(${javaQuote(request.body)},\n                MediaType.parse(${javaQuote(contentType)}));`
    : 'RequestBody body = null;';
  return `import okhttp3.*;

public class Main {
    public static void main(String[] args) throws Exception {
        OkHttpClient client = new OkHttpClient();

        ${body}

        Request request = new Request.Builder()
                .url(${javaQuote(request.url)})
                .method(${javaQuote(request.method.toUpperCase())}, body)
                ${headerLines}
                .build();

        try (Response response = client.newCall(request).execute()) {
            System.out.println(response.code());
            System.out.println(response.body().string());
        }
    }
}`;
}

function csharp(request: CodeRequest): string {
  const hasBody = Boolean(request.body);
  const headerLines = Object.entries(headersObject(request))
    .filter(([key]) => key.toLowerCase() !== 'content-type')
    .map(([key, value]) => `request.Headers.TryAddWithoutValidation(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
    .join('\n');
  return `using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;

class Program
{
    static async Task Main()
    {
        using var client = new HttpClient();
        using var request = new HttpRequestMessage(HttpMethod.${pascalMethod(request.method)}, ${JSON.stringify(request.url)});
${headerLines ? `${headerLines}\n` : ''}${hasBody ? `        request.Content = new StringContent(${JSON.stringify(request.body)}, Encoding.UTF8, "application/json");\n` : ''}
        using var response = await client.SendAsync(request);
        Console.WriteLine((int)response.StatusCode);
        Console.WriteLine(await response.Content.ReadAsStringAsync());
    }
}`;
}

function pascalMethod(method: string): string {
  const lower = method.toLowerCase();
  const known: Record<string, string> = { get: 'Get', post: 'Post', put: 'Put', patch: 'Patch', delete: 'Delete', head: 'Head', options: 'Options' };
  return known[lower] || 'Get';
}

function httpie(request: CodeRequest): string {
  const parts = [`http ${request.method.toUpperCase()} ${shellQuote(request.url)}`];
  for (const [key, value] of Object.entries(headersObject(request))) {
    parts.push(`  ${shellQuote(`${key}:${value}`)}`);
  }
  let command = parts.join(' \\\n');
  if (request.body) command += ` <<< ${shellQuote(request.body)}`;
  return command;
}

function powershell(request: CodeRequest): string {
  const headers = Object.entries(headersObject(request))
    .filter(([key]) => key.toLowerCase() !== 'content-type')
    .map(([key, value]) => `    ${JSON.stringify(key)} = ${JSON.stringify(value)}`)
    .join('\n');
  const contentType = Object.entries(headersObject(request)).find(([key]) => key.toLowerCase() === 'content-type')?.[1] || 'application/json';
  return `$headers = @{
${headers}
}

$response = Invoke-WebRequest \`
    -Method ${request.method.toUpperCase()} \`
    -Uri ${JSON.stringify(request.url)} \`
    -Headers $headers${request.body ? ` \`\n    -ContentType ${JSON.stringify(contentType)} \`\n    -Body ${JSON.stringify(request.body)}` : ''}

$response.StatusCode
$response.Content`;
}

export function generateCode(language: CodeLanguage, request: CodeRequest): string {
  switch (language) {
    case 'curl':
      return curl(request);
    case 'fetch':
      return fetchSnippet(request);
    case 'axios':
      return axios(request);
    case 'python':
      return python(request);
    case 'go':
      return go(request);
    case 'php':
      return php(request);
    case 'ruby':
      return ruby(request);
    case 'java':
      return java(request);
    case 'csharp':
      return csharp(request);
    case 'httpie':
      return httpie(request);
    case 'powershell':
      return powershell(request);
    default:
      return '';
  }
}

export function languageLabel(id: CodeLanguage): string {
  return CODE_LANGUAGES.find((language) => language.id === id)?.label || id;
}
