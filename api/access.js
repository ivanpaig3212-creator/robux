const REDIS_URL =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL;

const REDIS_TOKEN =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN;

const SESSION_SECRET =
    process.env.SITE_SESSION_SECRET;

const ACCESS_COOKIE =
    "site_access";

const SESSION_SECONDS =
    60 * 60 * 24 * 30;


/*
 * ---------------------------------------------------------
 * Redis
 * ---------------------------------------------------------
 */

async function redis(command) {

    const response =
        await fetch(
            REDIS_URL,
            {
                method: "POST",

                headers: {
                    "Authorization":
                        `Bearer ${REDIS_TOKEN}`,

                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(command)
            }
        );

    const data =
        await response.json();

    if (!response.ok) {
        throw new Error(
            data?.error ||
            "Redis request failed."
        );
    }

    return data.result;
}


/*
 * ---------------------------------------------------------
 * Base64 URL helpers
 * ---------------------------------------------------------
 */

function b64(bytes) {

    let s = "";

    for (
        let i = 0;
        i < bytes.length;
        i += 0x8000
    ) {

        s += String.fromCharCode(
            ...bytes.subarray(
                i,
                i + 0x8000
            )
        );
    }

    return btoa(s)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}


function b64d(value) {

    const padded =
        value
            .replace(/-/g, "+")
            .replace(/_/g, "/")
            .padEnd(
                value.length +
                (4 - value.length % 4) % 4,
                "="
            );

    const s =
        atob(padded);

    const bytes =
        new Uint8Array(
            s.length
        );

    for (
        let i = 0;
        i < s.length;
        i++
    ) {

        bytes[i] =
            s.charCodeAt(i);
    }

    return bytes;
}


/*
 * ---------------------------------------------------------
 * Sign session
 * ---------------------------------------------------------
 */

async function sign(payload) {

    const data =
        new TextEncoder().encode(
            SESSION_SECRET +
            "|" +
            payload
        );

    return b64(
        new Uint8Array(
            await crypto.subtle.digest(
                "SHA-256",
                data
            )
        )
    );
}


/*
 * ---------------------------------------------------------
 * Cookie
 * ---------------------------------------------------------
 */

function getCookie(
    req,
    name
) {

    const header =
        req.headers.cookie ||
        "";

    const match =
        header.match(
            new RegExp(
                "(?:^|;\\s*)" +
                name +
                "=([^;]+)"
            )
        );

    return match
        ? decodeURIComponent(
            match[1]
        )
        : null;
}


/*
 * ---------------------------------------------------------
 * JSON response
 * ---------------------------------------------------------
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
 * ---------------------------------------------------------
 * MAIN
 * ---------------------------------------------------------
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


        const body =
            typeof req.body === "string"
                ? JSON.parse(
                    req.body || "{}"
                )
                : (
                    req.body || {}
                );


        const key =
            String(
                body.key || ""
            )
            .trim()
            .toUpperCase();


        /*
         * -------------------------------------------------
         * REQUIRE KEY
         * -------------------------------------------------
         */

        if (!key) {

            return json(
                res,
                400,
                {
                    error:
                        "Access key is required."
                }
            );
        }


        /*
         * -------------------------------------------------
         * ATOMICALLY REDEEM KEY
         *
         * Only an "unused" key can create
         * an access session.
         * -------------------------------------------------
         */

        const lua = `
            local value =
                redis.call(
                    "GET",
                    KEYS[1]
                )

            if not value then
                return 0
            end

            local record =
                cjson.decode(value)

            if record["status"] ~= "unused" then
                return 0
            end

            record["status"] = "used"

            record["usedAt"] =
                ARGV[1]

            redis.call(
                "SET",
                KEYS[1],
                cjson.encode(record)
            )

            return 1
        `;


        const redeemed =
            await redis([
                "EVAL",
                lua,
                "1",
                `access:key:${key}`,
                new Date()
                    .toISOString()
            ]);


        /*
         * -------------------------------------------------
         * INVALID / USED / REVOKED KEY
         * -------------------------------------------------
         */

        if (
            Number(redeemed) !== 1
        ) {

            return json(
                res,
                401,
                {
                    error:
                        "Invalid, used, or revoked access key."
                }
            );
        }


        /*
         * -------------------------------------------------
         * CREATE SESSION
         *
         * IMPORTANT:
         * The KEY is stored inside the signed session.
         * This lets middleware later check whether
         * that exact key has been revoked.
         * -------------------------------------------------
         */

        const expiresAt =
            Date.now() +
            SESSION_SECONDS * 1000;


        const payload =
            expiresAt +
            "." +
            key;


        const signature =
            await sign(
                payload
            );


        const session =
            b64(
                new TextEncoder()
                    .encode(
                        payload
                    )
            ) +
            "." +
            signature;


        /*
         * -------------------------------------------------
         * SEND COOKIE
         * -------------------------------------------------
         */

        res.setHeader(
            "Set-Cookie",

            `${ACCESS_COOKIE}=${encodeURIComponent(session)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`
        );


        return json(
            res,
            200,
            {
                success:
                    true
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
                    "Unable to process access key."
            }
        );
    }
}
