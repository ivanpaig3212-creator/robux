import crypto from "crypto";

const REDIS_URL =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL;

const REDIS_TOKEN =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN;

const ADMIN_KEY =
    process.env.ADMIN_KEY;

const SESSION_SECRET =
    process.env.SITE_SESSION_SECRET;

const SESSION_COOKIE =
    "robux_admin_session";

const SESSION_SECONDS =
    60 * 60 * 8;


/*
 * REDIS
 */

async function redis(command) {

    if (!REDIS_URL || !REDIS_TOKEN) {

        throw new Error(
            "Redis environment variables are missing."
        );

    }

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
        await response
            .json()
            .catch(() => null);


    if (!response.ok) {

        throw new Error(
            data?.error ||
            "Redis request failed."
        );

    }


    return data?.result;
}


/*
 * ADMIN SESSION
 */

function sign(value) {

    return crypto
        .createHmac(
            "sha256",
            SESSION_SECRET || ""
        )
        .update(value)
        .digest("hex");

}


function createSession() {

    const timestamp =
        String(
            Date.now()
        );

    return (
        timestamp +
        "." +
        sign(timestamp)
    );

}


function verifySession(session) {

    if (
        !session ||
        !SESSION_SECRET
    ) {

        return false;

    }


    const parts =
        session.split(".");


    if (
        parts.length !== 2
    ) {

        return false;

    }


    const timestamp =
        parts[0];

    const signature =
        parts[1];


    const expected =
        sign(timestamp);


    if (
        signature.length !==
        expected.length
    ) {

        return false;

    }


    try {

        if (
            !crypto.timingSafeEqual(
                Buffer.from(signature),
                Buffer.from(expected)
            )
        ) {

            return false;

        }

    } catch (_) {

        return false;

    }


    const age =
        Date.now() -
        Number(timestamp);


    return (
        Number.isFinite(age) &&
        age >= 0 &&
        age <
            SESSION_SECONDS * 1000
    );

}


function getCookie(
    req,
    name
) {

    const cookieHeader =
        req.headers.cookie || "";


    const cookies =
        cookieHeader
            .split(";")
            .map(
                x => x.trim()
            );


    for (
        const cookie of cookies
    ) {

        const index =
            cookie.indexOf("=");


        if (
            index === -1
        ) {

            continue;

        }


        const key =
            cookie.slice(
                0,
                index
            );


        const value =
            cookie.slice(
                index + 1
            );


        if (
            key === name
        ) {

            return decodeURIComponent(
                value
            );

        }

    }


    return null;

}


function setSessionCookie(
    res,
    session
) {

    res.setHeader(
        "Set-Cookie",

        `${SESSION_COOKIE}=${encodeURIComponent(session)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`
    );

}


function clearSessionCookie(
    res
) {

    res.setHeader(
        "Set-Cookie",

        `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
    );

}


function isAdmin(req) {

    const session =
        getCookie(
            req,
            SESSION_COOKIE
        );


    return verifySession(
        session
    );

}


/*
 * JSON
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
 * KEY GENERATOR
 */

function generateKey() {

    const part1 =
        crypto
            .randomBytes(3)
            .toString("hex")
            .toUpperCase();

    const part2 =
        crypto
            .randomBytes(3)
            .toString("hex")
            .toUpperCase();

    const part3 =
        crypto
            .randomBytes(3)
            .toString("hex")
            .toUpperCase();

    const part4 =
        crypto
            .randomBytes(3)
            .toString("hex")
            .toUpperCase();


    return (
        "RBX-" +
        part1 +
        "-" +
        part2 +
        "-" +
        part3 +
        "-" +
        part4
    );

}


/*
 * CUSTOM DURATION
 */

function getDurationMs(
    value,
    unit
) {

    const number =
        Number(value);


    if (
        !Number.isFinite(number) ||
        number <= 0
    ) {

        return null;

    }


    const units = {

        minutes:
            60 * 1000,

        hours:
            60 * 60 * 1000,

        days:
            24 * 60 * 60 * 1000,

        weeks:
            7 * 24 * 60 * 60 * 1000

    };


    if (
        !units[unit]
    ) {

        return null;

    }


    const durationMs =
        number *
        units[unit];


    /*
     * Maximum:
     * 365 days
     */

    const maximum =
        365 *
        24 *
        60 *
        60 *
        1000;


    if (
        durationMs >
        maximum
    ) {

        return null;

    }


    return durationMs;

}


/*
 * MAIN HANDLER
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
                    success: false,
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


        const action =
            body.action;


        /*
         * LOGIN
         */

        if (
            action === "login"
        ) {

            const key =
                String(
                    body.key || ""
                );


            if (
                !ADMIN_KEY ||
                key !== ADMIN_KEY
            ) {

                return json(
                    res,
                    401,
                    {
                        success: false,
                        error:
                            "Invalid admin key."
                    }
                );

            }


            const session =
                createSession();


            setSessionCookie(
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

        }


        /*
         * LOGOUT
         */

        if (
            action === "logout"
        ) {

            clearSessionCookie(
                res
            );


            return json(
                res,
                200,
                {
                    success: true
                }
            );

        }


        /*
         * EVERYTHING BELOW
         * REQUIRES ADMIN LOGIN
         */

        if (
            !isAdmin(req)
        ) {

            return json(
                res,
                401,
                {
                    success: false,
                    error:
                        "Unauthorized."
                }
            );

        }


        /*
         * GENERATE
         */

        if (
            action === "generate"
        ) {

            const durationValue =
                Number(
                    body.durationValue
                );


            const durationUnit =
                String(
                    body.durationUnit || ""
                );


            const durationMs =
                getDurationMs(
                    durationValue,
                    durationUnit
                );


            if (
                !durationMs
            ) {

                return json(
                    res,
                    400,
                    {
                        success: false,
                        error:
                            "Invalid duration. Use 1–365 days maximum."
                    }
                );

            }


            let candidate;


            for (
                let i = 0;
                i < 10;
                i++
            ) {

                const possible =
                    generateKey();


                const existing =
                    await redis([
                        "GET",
                        `access:key:${possible}`
                    ]);


                if (!existing) {

                    candidate =
                        possible;

                    break;

                }

            }


            if (!candidate) {

                return json(
                    res,
                    500,
                    {
                        success: false,
                        error:
                            "Could not generate a unique key."
                    }
                );

            }


            const record = {

                key:
                    candidate,

                status:
                    "unused",

                durationValue:
                    durationValue,

                durationUnit:
                    durationUnit,

                durationMs:
                    durationMs,

                createdAt:
                    new Date()
                        .toISOString(),

                usedAt:
                    null,

                expiresAt:
                    null,

                revokedAt:
                    null

            };


            await redis([
                "SET",
                `access:key:${candidate}`,
                JSON.stringify(record)
            ]);


            await redis([
                "SADD",
                "access:keys",
                candidate
            ]);


            return json(
                res,
                200,
                {
                    success: true,
                    key:
                        candidate,

                    durationValue:
                        durationValue,

                    durationUnit:
                        durationUnit,

                    durationMs:
                        durationMs
                }
            );

        }


        /*
         * LIST
         */

        if (
            action === "list"
        ) {

            const members =
                await redis([
                    "SMEMBERS",
                    "access:keys"
                ]);


            const keys =
                Array.isArray(
                    members
                )
                    ? members
                    : [];


            const result =
                [];


            for (
                const key of keys
            ) {

                const raw =
                    await redis([
                        "GET",
                        `access:key:${key}`
                    ]);


                if (!raw) {

                    continue;

                }


                try {

                    const record =
                        typeof raw === "string"
                            ? JSON.parse(raw)
                            : raw;


                    result.push({

                        key:
                            record.key ||
                            key,

                        status:
                            record.status ||
                            "unused",

                        durationValue:
                            record.durationValue ??
                            null,

                        durationUnit:
                            record.durationUnit ??
                            null,

                        durationMs:
                            record.durationMs ??
                            null,

                        createdAt:
                            record.createdAt ??
                            null,

                        usedAt:
                            record.usedAt ??
                            null,

                        expiresAt:
                            record.expiresAt ??
                            null,

                        revokedAt:
                            record.revokedAt ??
                            null

                    });

                } catch (_) {

                    // Ignore malformed records.

                }

            }


            result.sort(
                (
                    a,
                    b
                ) =>
                    String(
                        b.createdAt || ""
                    ).localeCompare(
                        String(
                            a.createdAt || ""
                        )
                    )
            );


            return json(
                res,
                200,
                {
                    success: true,
                    keys:
                        result
                }
            );

        }


        /*
         * REVOKE
         */

        if (
            action === "revoke"
        ) {

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
                        success: false,
                        error:
                            "Missing key."
                    }
                );

            }


            const redisKey =
                `access:key:${key}`;


            const raw =
                await redis([
                    "GET",
                    redisKey
                ]);


            if (!raw) {

                return json(
                    res,
                    404,
                    {
                        success: false,
                        error:
                            "Key not found."
                    }
                );

            }


            const record =
                typeof raw === "string"
                    ? JSON.parse(raw)
                    : raw;


            if (
                record.status ===
                "revoked"
            ) {

                return json(
                    res,
                    200,
                    {
                        success: true
                    }
                );

            }


            record.status =
                "revoked";


            record.revokedAt =
                new Date()
                    .toISOString();


            await redis([
                "SET",
                redisKey,
                JSON.stringify(record)
            ]);


            return json(
                res,
                200,
                {
                    success: true
                }
            );

        }


        /*
         * REMOVE
         *
         * Permanently deletes an EXPIRED
         * or REVOKED key.
         */

        if (
            action === "remove"
        ) {

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
                        success: false,
                        error:
                            "Missing key."
                    }
                );

            }


            const redisKey =
                `access:key:${key}`;


            const raw =
                await redis([
                    "GET",
                    redisKey
                ]);


            if (!raw) {

                /*
                 * Clean up the set too,
                 * just in case.
                 */

                await redis([
                    "SREM",
                    "access:keys",
                    key
                ]);


                return json(
                    res,
                    200,
                    {
                        success: true
                    }
                );

            }


            const record =
                typeof raw === "string"
                    ? JSON.parse(raw)
                    : raw;


            const now =
                Date.now();


            const expiresAt =
                Number(
                    record.expiresAt
                );


            const isExpired =
                Number.isFinite(
                    expiresAt
                ) &&
                expiresAt <= now;


            const isRevoked =
                record.status ===
                "revoked";


            /*
             * Only allow removing:
             *
             * EXPIRED
             * or
             * REVOKED
             */

            if (
                !isExpired &&
                !isRevoked
            ) {

                return json(
                    res,
                    400,
                    {
                        success: false,
                        error:
                            "Only expired or revoked keys can be removed."
                    }
                );

            }


            /*
             * Delete the actual key.
             */

            await redis([
                "DEL",
                redisKey
            ]);


            /*
             * Remove it from the key list.
             */

            await redis([
                "SREM",
                "access:keys",
                key
            ]);


            return json(
                res,
                200,
                {
                    success: true
                }
            );

        }


        return json(
            res,
            400,
            {
                success: false,
                error:
                    "Unknown action."
            }
        );


    } catch (error) {

        console.error(
            "Keys API error:",
            error
        );


        return json(
            res,
            500,
            {
                success: false,
                error:
                    "Server error."
            }
        );

    }

}
