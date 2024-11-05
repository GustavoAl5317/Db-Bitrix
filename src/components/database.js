import mysql from 'mysql'; // ou outra biblioteca de banco de dados

const connection = mysql.createConnection({
    host: '10.172.0.24',
    user: 'root',
    password: 'Int@Dc5382',
    database: 'panel_services'
});

function insertData(data) {
    const sql = `INSERT INTO panel_auto (
                    Id_Tarefa, Nome, Descricao, Empresa, PMO, Contratos, Servicos, Categoria, Status,
                    Tempo_Gasto, Data_Criacao, Data_Modificacao, Data_Conclusao, Criado_Por,
                    Alterado_Por, Responsavel, Comentario_Encerramento
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const values = [
        data.id,                            // ID da tarefa
        data.title,                         // Título da tarefa
        data.description || '',             // Descrição da tarefa
        data.company || '',                 // Nome da empresa (ajuste conforme necessário)
        data.pmo || '',                     // Informação do PMO (ajuste conforme necessário)
        data.contract || '',                // Informação dos contratos
        data.service || '',                 // Serviços associados à tarefa
        data.uf_auto_793377858165 || '',   // Categoria (ajuste conforme necessário)
        data.status,                        // Status
        data.timeSpentInLogs,              // Tempo gasto em minutos
        data.createdDate,                   // Data de criação
        data.changedDate,                   // Data de modificação
        data.closedDate || '',              // Data de conclusão
        data.createdBy,                     // Criado por
        data.changedBy || '',               // Alterado por
        data.responsibleId,                 // Responsável
        data.uf_auto_856888266589 || ''     // Comentário de encerramento
    ];

    connection.query(sql, values, (err, results) => {
        if (err) throw err;
        console.log('Dados inseridos:', results.insertId);
    });
}
