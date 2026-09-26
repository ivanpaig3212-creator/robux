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

// Used only for old keys that don't have
// a custom duration stored.
const LEGACY_SESSION_SECONDS =
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
 * Create a session that middleware.js understands.
 *
 * The first part is the exact expiration timestamp.
 */

function createSession(expiresAt) {

    const timestamp =
        String(expiresAt);

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
    session,
    maxAge
) {

    res.setHeader(
        "Set-Cookie",
        `${SESSION_COOKIE}=${encodeURIComponent(session)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
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
                ? JSON.parse(
                    req.body || "{}"
                )
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
         * The Lua script:
         *
         * 1. Finds the key
         * 2. Checks that it is unused
         * 3. Reads its custom duration
         * 4. Calculates expiration from NOW
         * 5. Marks the key as used
         * 6. Stores expiresAt
         *
         * Everything happens atomically.
         */

        const lua = `

local raw = redis.call(
    "GET",
    KEYS[1]
)

if not raw then
    return {0, "missing"}
end


local ok, data =
    pcall(
        cjson.decode,
        raw
    )


if not ok or not data then
    return {0, "invalid"}
end


if data.status ~= "unused" then
    return {0, "used"}
end


local durationMs =
    tonumber(
        data.durationMs
    )


-- Support keys created by the old system.
if not durationMs or durationMs <= 0 then
    durationMs = 2592000000
end


local nowMs =
    tonumber(ARGV[1])


local usedAt =
    ARGV[2]


local expiresAt =
    nowMs + durationMs


data.status = "used"

data.usedAt =
    usedAt

data.expiresAt =
    expiresAt


redis.call(
    "SET",
    KEYS[1],
    cjson.encode(data)
)


return {
    1,
    tostring(expiresAt)
}

`;


        const nowMs =
            Date.now();

        const usedAt =
            new Date(
                nowMs
            ).toISOString();


        const result =
            await redis([
                "EVAL",
                lua,
                "1",
                `access:key:${key}`,
                String(nowMs),
                usedAt
            ]);


        /*
         * Failed redemption
         */

        if (
            !Array.isArray(result) ||
            Number(result[0]) !== 1
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
         * Get the exact expiration
         * calculated by Redis.
         */

        const expiresAt =
            Number(
                result[1]
            );


        if (
            !Number.isFinite(expiresAt) ||
            expiresAt <= nowMs
        ) {

            return json(
                res,
                500,
                {
                    error:
                        "Could not create access session."
                }
            );

        }


        /*
         * Convert remaining time to seconds
         * for the browser cookie.
         */

        const remainingSeconds =
            Math.max(
                1,
                Math.ceil(
                    (
                        expiresAt -
                        nowMs
                    ) / 1000
                )
            );


        /*
         * Create session using the same
         * format middleware.js currently expects.
         */

        const session =
            createSession(
                expiresAt
            );


        setAccessCookie(
            res,
            session,
            remainingSeconds
        );


        return json(
            res,
            200,
            {
                success: true,
                expiresAt
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
