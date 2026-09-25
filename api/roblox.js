export default async function handler(req, res) {
    try {
        const { action, keyword, userIds } = req.query;

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
            const data = await response.json();

            return res.status(response.status).json(data);
        }

        if (action === "avatar") {
            if (!userIds) {
                return res.status(400).json({
                    error: "Missing user ID"
                });
            }

            const url =
                "https://thumbnails.roblox.com/v1/users/avatar-headshot" +
                "?userIds=" +
                encodeURIComponent(userIds) +
                "&size=150x150&format=Png&isCircular=false";

            const response = await fetch(url);
            const data = await response.json();

            return res.status(response.status).json(data);
        }

        return res.status(400).json({
            error: "Invalid action"
        });

    } catch (error) {
        return res.status(500).json({
            error: "Server failed",
            details: error.message
        });
    }
}
