export default async function handler(req, res) {
    try {
        const { action, keyword, userIds, userId } = req.query;

        // =========================
        // SEARCH ROBLOX USERS
        // =========================
        if (action === "search") {
            if (!keyword || keyword.length < 2) {
                return res.status(400).json({
                    error: "Username is too short"
                });
            }

            const url =
                "https://users.roblox.com/v1/users/search?keyword=" +
                encodeURIComponent(keyword) +
                "&limit=10";

            const response = await fetch(url);
            const text = await response.text();

            if (!response.ok) {
                return res.status(response.status).send(text);
            }

            return res
                .status(200)
                .setHeader("Content-Type", "application/json")
                .send(text);
        }

        // =========================
        // GET ROBLOX AVATAR
        // =========================
        if (action === "avatar") {
            if (!userIds) {
                return res.status(400).json({
                    error: "Missing userIds"
                });
            }

            const url =
                "https://thumbnails.roblox.com/v1/users/avatar-headshot" +
                "?userIds=" +
                encodeURIComponent(userIds) +
                "&size=150x150&format=Png&isCircular=false";

            const response = await fetch(url);
            const text = await response.text();

            if (!response.ok) {
                return res.status(response.status).send(text);
            }

            return res
                .status(200)
                .setHeader("Content-Type", "application/json")
                .send(text);
        }

        // =========================
        // GET ROBLOX USER DETAILS
        // =========================
        if (action === "details") {
            if (!userId) {
                return res.status(400).json({
                    error: "Missing userId"
                });
            }

            const url =
                "https://users.roblox.com/v1/users/" +
                encodeURIComponent(userId);

            const response = await fetch(url);
            const text = await response.text();

            if (!response.ok) {
                return res.status(response.status).send(text);
            }

            return res
                .status(200)
                .setHeader("Content-Type", "application/json")
                .send(text);
        }

        // =========================
        // INVALID ACTION
        // =========================
        return res.status(400).json({
            error: "Invalid action"
        });

    } catch (error) {
        console.error(error);

        return res.status(500).json({
            error: "Server failed to contact Roblox",
            details: error.message
        });
    }
}
