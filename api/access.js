import crypto from "crypto";

const REDIS_URL =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL;

const REDIS_TOKEN =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN;

const SESSION_SECRET =
    process.env.SITE_SESSION_SECRET;

const SESSION_COOKIE =
    "site_access";

const SESSION_SECONDS =
    60 * 60 * 24 * 30;


/*
 * Redis REST helper
 */

async function redis(command) {

    if (!REDIS_URL || !REDIS_TOKEN) {
        throw new Error(
            "Redis environment variables are missing."
        );
    }

    const response = await fetch(
        REDIS_URL,
        {
            method: "POST",

            headers: {
                "Authorization":
                    `Bearer ${REDIS_TOKEN}`,

                "Content-Type":
                    "application/json"
            },

            body: JSON.stringify(command)
        }
    );

    const data =
        await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(
            data?.error ||
            "Redis request failed."
        );
    }

    return data?.result;
}


/*
 * Create the same type of session
 * that middleware.js understands.
 */

function createSession() {

    const expires =
        Date.now() +
        SESSION_SECONDS * 1000;

    const timestamp =
        String(expires);

    const signature =
        crypto
            .createHash("sha256")
            .update(
                SESSION_SECRET +
                "|" +
                timestamp
            )
            .digest("base64url");

    return (
        timestamp +
        "." +
        signature
    );
}


/*
 * Set access cookie
 */

function setAccessCookie(
    res,
    session
) {

    res.setHeader(
        "Set-Cookie",

        `${SESSION_COOKIE}=${encodeURIComponent(session)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`
    );
}


/*
 * JSON response
 */

function json(
    res,
    status,
    data
) {

    res.setHeader(
        "Content-Type",
        "application/json"
    );

    res.setHeader(
        "Cache-Control",
        "no-store"
    );

    return res
        .status(status)
        .json(data);
}


/*
 * Main API
 */

export default async function handler(
    req,
    res
) {

    try {

        if (
            req.method !== "POST"
        ) {

            return json(
                res,
                405,
                {
                    error:
                        "Method not allowed."
                }
            );
        }


        if (!SESSION_SECRET) {

            return json(
                res,
                500,
                {
                    error:
                        "SITE_SESSION_SECRET is not configured."
                }
            );
        }


        const body =
            typeof req.body === "string"
                ? JSON.parse(req.body || "{}")
                : (req.body || {});


        const key =
            String(
                body.key || ""
            )
            .trim()
            .toUpperCase();


        if (!key) {

            return json(
                res,
                400,
                {
                    error:
                        "Please enter an access key."
                }
            );
        }


        /*
         * IMPORTANT:
         *
         * This Lua script checks and consumes
         * the key atomically.
         *
         * That means two people cannot
         * successfully redeem the same key
         * at the same time.
         */

        const lua = `
local raw = redis.call("GET", KEYS[1])

if not raw then
    return 0
end

local ok, data = pcall(cjson.decode, raw)

if not ok or not data then
    return 0
end

if data.status ~= "unused" then
    return 0
end

data.status = "used"
data.usedAt = ARGV[1]

redis.call(
    "SET",
    KEYS[1],
    cjson.encode(data)
)

return 1
`;


        const result =
            await redis([
                "EVAL",
                lua,
                "1",
                `access:key:${key}`,
                new Date().toISOString()
            ]);


        if (
            Number(result) !== 1
        ) {

            return json(
                res,
                403,
                {
                    error:
                        "Invalid or already-used access key."
                }
            );
        }


        /*
         * Key was successfully consumed.
         * Give this visitor a 30-day session.
         */

        const session =
            createSession();


        setAccessCookie(
            res,
            session
        );


        return json(
            res,
            200,
            {
                success: true
            }
        );


    } catch (error) {

        console.error(
            "Access API error:",
            error
        );

        return json(
            res,
            500,
            {
                error:
                    "Request failed."
            }
        );
    }
}
