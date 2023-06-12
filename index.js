const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const port = process.env.PORT || 5000;

// middleware
const corsOptions = {
    origin: '*',
    credentials: true,
    optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());

const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'unauthorized access' });
    }
    // bearer token
    const token = authorization.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ error: true, message: 'unauthorized access' });
        }

        req.decoded = decoded;
        next();
    });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.59h5qtx.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const usersCollection = client.db("sportifyDB").collection("users");
        const classCollection = client.db("sportifyDB").collection("classes");
        const cartCollection = client.db("sportifyDB").collection("carts");

        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
            res.send({ token });
        });

        // Warning: use verifyJWT before using verifyAdmin
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);

            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: 'forbidden access' });
            }

            next();
        };

        // Warning: use verifyJWT before using verifyInstructor
        const verifyInstructor = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);

            if (user?.role !== 'instructor') {
                return res.status(403).send({ error: true, message: 'forbidden access' });
            }

            next();
        };

        // users related apis
        app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email };
            const existingUser = await usersCollection.findOne(query);

            if (existingUser) {
                return res.send({ message: 'user already exists' });
            }

            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        // admin related apis 
        // check admin
        app.get('/users/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;

            if (req.decoded.email !== email) {
                res.send({ admin: false });
            }

            const query = { email: email };
            const user = await usersCollection.findOne(query);
            const result = { admin: user?.role === 'admin' };
            res.send(result);
        });

        // make admin 
        app.patch('/users/admin/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            };

            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // instructor related apis 
        // get all instructor 
        app.get('/instructors', async (req, res) => {
            const query = { role: 'instructor' };
            const result = await usersCollection.find(query).toArray();
            res.send(result);
        });

        // instructor stat 
        app.get('/instructor-stats/:name', async(req, res) => {
            const userName = req.params.name;

            const pipeline = [
                {
                    $match: { instructorName: userName, status: 'approved' }
                },
                {
                    $group: {
                        _id: "$instructorName",
                        classes: { $addToSet: "$className" },
                        count: { $sum: 1 }
                    }
                }
            ];

            const result = await classCollection.aggregate(pipeline).toArray();
            res.send(result);
        });

        // check instructor
        app.get('/users/instructor/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;

            if (req.decoded.email !== email) {
                res.send({ instructor: false });
            }

            const query = { email: email };
            const user = await usersCollection.findOne(query);
            const result = { instructor: user?.role === 'instructor' };
            res.send(result);
        });

        // make instructor 
        app.patch('/users/instructor/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    role: 'instructor'
                }
            };

            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // class related apis 
        app.get('/classes', async (req, res) => {
            const result = await classCollection.find().toArray();
            res.send(result);
        });

        // get approved classes 
        app.get('/classes/approved', async (req, res) => {
            const query = { status: 'approved' };
            const result = await classCollection.find(query).toArray();
            res.send(result);
        });

        // upload a class 
        app.post('/classes', verifyJWT, verifyInstructor, async (req, res) => {
            const classData = req.body;
            const result = await classCollection.insertOne(classData);
            res.send(result);
        });

        // update class status 
        app.patch('/classes/status/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const document = req.body;
            const updateDoc = {
                $set: {
                    status: document.status
                }
            };

            const result = await classCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // send feedback 
        app.patch('/classes/feedback/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const document = req.body;
            const updateDoc = {
                $set: {
                    feedback: document.feedback
                }
            };

            const result = await classCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // cart related apis 
        app.get('/carts', verifyJWT, async (req, res) => {
            const email = req.query.email;
            if (!email) {
                res.send([]);
            }

            const decodedEmail = req.decoded.email;
            if (email !== decodedEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' });
            }

            const query = { email: email };
            const result = await cartCollection.find(query).toArray();
            res.send(result);
        });

        app.post('/carts', async (req, res) => {
            const item = req.body;
            const result = await cartCollection.insertOne(item);
            res.send(result);
        });

        app.delete('/carts/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await cartCollection.deleteOne(query);
            res.send(result);
        });

        

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Sportify Server is running..');
});

app.listen(port, () => {
    console.log(`Sportify is running on port ${port}`);
});


// [
//     {
//         name: 'abir',
//         class: 'math',
//         status: 'approved'
//     },
//     {
//         name: 'akash',
//         class: 'eng',
//         status: 'approved'
//     },
//     {
//         name: 'abir',
//         class: 'bangla',
//         status: 'approved'
//     },
//     {
//         name: 'hanif',
//         class: 'usa',
//         status: 'approved'
//     },
//     {
//         name: 'abir',
//         class: 'hindi',
//         status: 'denied'
//     },
//     {
//         name: 'alim',
//         class: 'bio',
//         status: 'approved'
//     },
//     {
//         name: 'abir',
//         class: 'math',
//         status: 'approved'
//     },
// ]